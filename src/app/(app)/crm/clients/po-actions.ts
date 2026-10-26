"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { projectScope } from "@/lib/scope";
import { putFile, deleteFile, validateUpload, UploadError } from "@/lib/storage";
import { billedAgainstPo } from "@/lib/client-account";
import { formToObject, zOptDate, zOptStr, zReqStr } from "@/lib/form";
import { num } from "@/lib/utils";

/** Whoever receives the client's order (sales, designer, project manager, management) or bills it (accounts) can record it. */
async function mayRecord() {
  const c = await assertPerm("clients:view");
  if (!c.can("invoices:create") && !c.can("quotations:edit")) throw new UserError("You can't record purchase orders.");
  return c;
}

async function loadClient(c: Ctx, clientId: string) {
  const cl = await db.client.findFirst({ where: { id: clientId, companyId: c.companyId, deletedAt: null }, select: { id: true, name: true } });
  if (!cl) throw new UserError("Client not found.");
  return cl;
}

const schema = z.object({
  clientId: zReqStr("Choose the client"),
  number: zReqStr("Enter the client's PO number"),
  poDate: zOptDate,
  amount: z.coerce.number({ message: "Enter the PO value" }).positive("The PO value must be above 0"),
  scopes: zOptStr,
  projectId: zOptStr,
  quotationId: zOptStr,
  note: zOptStr,
});

/** Records the client's purchase order (value without GST, what it covers, and the file). Invoices can then be billed against it. */
export async function createClientPO(fd: FormData) {
  return run(async () => {
    const c = await mayRecord();
    const d = schema.parse(formToObject(fd));
    const cl = await loadClient(c, d.clientId);
    if (await db.clientPO.findFirst({ where: { companyId: c.companyId, clientId: d.clientId, number: d.number }, select: { id: true } })) throw new UserError(`${cl.name} already has a PO numbered ${d.number}.`);
    if (d.projectId && !(await db.project.findFirst({ where: { id: d.projectId, ...projectScope(c), clientId: d.clientId }, select: { id: true } }))) throw new UserError("That project is not this client's, or you can't open it.");
    const quote = d.quotationId ? await db.quotation.findFirst({ where: { id: d.quotationId, companyId: c.companyId, clientId: d.clientId, deletedAt: null }, select: { id: true, clientPoNo: true, clientPoDate: true, projectId: true } }) : null;
    if (d.quotationId && !quote) throw new UserError("That quotation is not this client's.");

    let key: string | null = null;
    const f = fd.get("file");
    let doc: Awaited<ReturnType<typeof validateUpload>> | null = null;
    if (f instanceof File && f.size > 0) {
      try {
        doc = await validateUpload(f);
      } catch (e) {
        if (e instanceof UploadError) throw new UserError(e.message);
        throw e;
      }
    }
    try {
      if (doc) key = await putFile(c.companyId, doc.bytes, doc.ext);
      const po = await db.$transaction(async (tx) => {
        let documentId: string | null = null;
        if (doc && key) {
          const x = await tx.document.create({ data: { companyId: c.companyId, name: `PO ${d.number} – ${cl.name}.${doc.ext}`, type: "CONTRACT", folder: "Client purchase orders", entityType: "CLIENT", entityId: d.clientId, storageKey: key, mimeType: doc.mime, size: doc.size, uploadedById: c.userId } });
          documentId = x.id;
        }
        const p = await tx.clientPO.create({ data: { companyId: c.companyId, clientId: d.clientId, number: d.number, poDate: d.poDate ?? null, amount: d.amount, scopes: d.scopes ?? null, projectId: d.projectId ?? quote?.projectId ?? null, quotationId: d.quotationId ?? null, documentId, note: d.note ?? null, createdById: c.userId } });
        // the quotation cover prints the client's PO number and date: fill them in if nobody has
        if (quote && !quote.clientPoNo) await tx.quotation.update({ where: { id: quote.id }, data: { clientPoNo: d.number, clientPoDate: quote.clientPoDate ?? d.poDate ?? null } });
        await audit(c, { action: "CREATE", entityType: "ClientPO", entityId: p.id, summary: `${c.name} recorded ${cl.name}'s PO ${d.number} for ₹${d.amount.toLocaleString("en-IN")}${d.scopes ? ` (${d.scopes})` : ""}` }, tx);
        return p;
      });
      revalidatePath(`/crm/clients/${d.clientId}`);
      return { message: `PO ${po.number} recorded`, data: { id: po.id } };
    } catch (e) {
      if (key) await deleteFile(key);
      throw e;
    }
  });
}

const editSchema = z.object({ number: zReqStr("Enter the client's PO number"), poDate: zOptDate, amount: z.coerce.number().positive("The PO value must be above 0"), scopes: zOptStr, note: zOptStr });

/** Change a PO (an amendment). The value can never go below what has already been billed against it. */
export async function updateClientPO(id: string, fd: FormData) {
  return run(async () => {
    const c = await mayRecord();
    const d = editSchema.parse(formToObject(fd));
    const po = await db.clientPO.findFirst({ where: { id, companyId: c.companyId } });
    if (!po) throw new UserError("PO not found.");
    if (po.status === "CANCELLED") throw new UserError("A cancelled PO cannot be changed.");
    const billed = await billedAgainstPo(id);
    if (d.amount + 0.5 < billed) throw new UserError(`₹${billed.toLocaleString("en-IN")} has already been billed against this PO. The value cannot go below that.`);
    if (d.number !== po.number && (await db.clientPO.findFirst({ where: { companyId: c.companyId, clientId: po.clientId, number: d.number, id: { not: id } }, select: { id: true } }))) throw new UserError("This client already has a PO with that number.");
    await db.clientPO.update({ where: { id }, data: { number: d.number, poDate: d.poDate ?? null, amount: d.amount, scopes: d.scopes ?? null, note: d.note ?? null } });
    await audit(c, { action: "UPDATE", entityType: "ClientPO", entityId: id, summary: `${c.name} changed PO ${po.number}${num(po.amount) !== d.amount ? ` from ₹${num(po.amount).toLocaleString("en-IN")} to ₹${d.amount.toLocaleString("en-IN")}` : ""}`, oldValue: { amount: num(po.amount), number: po.number }, newValue: { amount: d.amount, number: d.number } });
    revalidatePath(`/crm/clients/${po.clientId}`);
    return { message: "PO updated" };
  });
}

/** Close a fully billed PO, or cancel one that was withdrawn (only if nothing has been billed against it). */
export async function setClientPoStatus(id: string, status: "OPEN" | "CLOSED" | "CANCELLED", fd?: FormData) {
  return run(async () => {
    const c = await mayRecord();
    const po = await db.clientPO.findFirst({ where: { id, companyId: c.companyId } });
    if (!po) throw new UserError("PO not found.");
    const reason = String(fd?.get("reason") ?? "").trim();
    if (status === "CANCELLED") {
      if ((await billedAgainstPo(id)) > 0) throw new UserError("Invoices have been billed against this PO. Cancel them first, or close the PO instead.");
      if (reason.length < 3) throw new UserError("Say why the PO is cancelled.");
    }
    await db.clientPO.update({ where: { id }, data: { status, note: status === "CANCELLED" ? `${po.note ? po.note + " · " : ""}Cancelled: ${reason}` : po.note } });
    await audit(c, { action: "UPDATE", entityType: "ClientPO", entityId: id, summary: `${c.name} set PO ${po.number} to ${status.toLowerCase()}${reason ? `: ${reason}` : ""}` });
    revalidatePath(`/crm/clients/${po.clientId}`);
    return { message: `PO ${status === "OPEN" ? "reopened" : status.toLowerCase()}` };
  });
}
