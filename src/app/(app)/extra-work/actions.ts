"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextNumber } from "@/lib/sequence";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { projectScope } from "@/lib/scope";
import { putFile, deleteFile, validateUpload, UploadError } from "@/lib/storage";
import { formToObject, zNumPos, zOptStr, zReqStr } from "@/lib/form";
import { formatINR } from "@/lib/utils";
import { dueIn, raiseAction, resolveActionsFor } from "@/lib/action-items";

const schema = z.object({
  projectId: zReqStr("Choose the project"),
  title: zReqStr("Say what the extra work is"),
  description: zOptStr,
  amount: zNumPos(),
  kind: z.enum(["CHARGEABLE", "INCLUDED", "EMERGENCY", "OWN_REWORK", "CONCESSION"]).default("CHARGEABLE"),
  inOriginalScope: z.enum(["YES", "NO"]).optional(),
  scopeNote: zOptStr,
  costEstimate: zNumPos().default(0),
  scheduleImpactDays: z.coerce.number().int().min(-365).max(365).default(0),
});

/** Only these kinds are ever billed to the client. */
const BILLABLE = ["CHARGEABLE", "EMERGENCY"];

async function load(c: Ctx, id: string) {
  const w = await db.additionalWork.findFirst({ where: { id, companyId: c.companyId, project: projectScope(c) }, include: { project: { select: { id: true, code: true, name: true, clientId: true, projectManagerId: true, supervisorId: true, status: true } } } });
  if (!w) throw new UserError("Extra work not found, or you aren't on that project.");
  return w;
}
const refresh = () => revalidatePath("/extra-work");

/** Work outside the agreed scope. SOP: it cannot start until the client has approved it in writing. */
export async function createExtraWork(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("extra_work:create");
    const d = schema.parse(formToObject(fd));
    // DSC: the site team describes the work; only the directors (people who see prices) put the price on it
    const pricing = c.can("margins:view");
    if (!pricing) { d.amount = 0; d.costEstimate = 0; if (d.kind === "CONCESSION") throw new UserError("A concession is decided by a director. Choose another kind, and tell the director."); }
    const p = await db.project.findFirst({ where: { id: d.projectId, ...projectScope(c) } });
    if (!p) throw new UserError("Project not found or you aren't on it.");
    if (["COMPLETED", "CANCELLED"].includes(p.status)) throw new UserError("This project is closed.");
    // the scope check: what kind of work is this, really?
    if (d.kind === "CHARGEABLE" && d.inOriginalScope === "YES") throw new UserError("You said it is already in the contract. Then it is not chargeable: choose “Included in the contract”.");
    if (d.kind === "INCLUDED" && d.inOriginalScope === "NO") throw new UserError("You said it is outside the contract. Then choose “Chargeable”, or “Emergency” if it cannot wait.");
    if ((d.kind === "INCLUDED" || d.kind === "OWN_REWORK") && d.amount > 0) throw new UserError(d.kind === "OWN_REWORK" ? "Putting right DSC's own mistake is never charged to the client. Set the cost to 0." : "Work already in the contract cannot be charged again. Set the cost to 0.");
    if (d.kind === "CONCESSION" && d.amount <= 0) throw new UserError("Enter the value of what DSC is giving free, so the concession is on record.");
    if ((d.kind === "EMERGENCY" || d.kind === "CONCESSION" || d.kind === "OWN_REWORK") && !(d.scopeNote ?? "").trim()) throw new UserError("Say why (what the emergency is, why it is a concession, or what went wrong).");
    const w = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, c.companyId, "AW");
      const x = await tx.additionalWork.create({ data: { companyId: c.companyId, number, projectId: p.id, title: d.title, description: d.description, amount: d.amount, requestedById: c.userId, kind: d.kind, inOriginalScope: d.inOriginalScope ? d.inOriginalScope === "YES" : null, scopeNote: d.scopeNote ?? null, costEstimate: d.costEstimate, scheduleImpactDays: d.scheduleImpactDays } });
      await audit(c, { action: "CREATE", entityType: "AdditionalWork", entityId: x.id, summary: `Raised extra work ${number} on ${p.code}: ${d.title} (${formatINR(d.amount)})` }, tx);
      if (p.projectManagerId && p.projectManagerId !== c.userId) await notifyUsers([p.projectManagerId], { companyId: c.companyId, type: "GENERAL", title: `Extra work ${number} raised on ${p.code}`, body: d.title, link: "/extra-work" }, tx);
      if (!pricing && BILLABLE.includes(d.kind)) await notifyRoles(c.companyId, ["OWNER", "MANAGEMENT"], { type: "GENERAL", title: `Extra work ${number} on ${p.code} needs a price`, body: `${d.title}${d.description ? ` – ${d.description}` : ""} (raised by ${c.name})`, link: "/extra-work", dedupeKey: `aw-price:${x.id}` }, tx);
      return x;
    });
    refresh();
    return { message: `Extra work ${w.number} saved as a draft`, data: { id: w.id } };
  });
}

const priceSchema = z.object({ amount: zNumPos(), costEstimate: zNumPos().default(0) });

/** Directors put the price on extra work the site team raised (before it is sent to the client). */
export async function setExtraWorkPrice(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("extra_work:edit");
    if (!c.can("margins:view")) throw new UserError("Only the directors put a price on extra work.");
    const w = await load(c, id);
    if (!["DRAFT", "REJECTED"].includes(w.status)) throw new UserError("The price can be changed only before it is sent to the client.");
    const d = priceSchema.parse(formToObject(fd));
    if ((w.kind === "INCLUDED" || w.kind === "OWN_REWORK") && d.amount > 0) throw new UserError("This kind of work is never charged to the client.");
    await db.additionalWork.update({ where: { id }, data: { amount: d.amount, costEstimate: d.costEstimate } });
    await audit(c, { action: "UPDATE", entityType: "AdditionalWork", entityId: id, summary: `Price of extra work ${w.number} set to ${formatINR(d.amount)}`, oldValue: { amount: Number(w.amount) }, newValue: d });
    refresh();
    return { message: "Price saved" };
  });
}

export async function sendExtraWork(id: string) {
  return run(async () => {
    const c = await assertPerm("extra_work:edit");
    const w = await load(c, id);
    if (!BILLABLE.includes(w.kind)) throw new UserError("Only chargeable or emergency work is sent to the client for approval.");
    if (!["DRAFT", "REJECTED"].includes(w.status)) throw new UserError("This has already been sent to the client.");
    if (Number(w.amount) <= 0) throw new UserError("Add the cost before sending it to the client.");
    await db.$transaction(async (tx) => {
      await tx.additionalWork.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), decidedAt: null, decidedByName: null, decisionNote: null, decisionVia: null } });
      const clientUsers = await tx.user.findMany({ where: { companyId: c.companyId, role: "CLIENT", clientId: w.project.clientId, isActive: true, deletedAt: null }, select: { id: true } });
      await notifyUsers(clientUsers.map((u) => u.id), { companyId: c.companyId, type: "GENERAL", title: `Please approve extra work: ${w.title}`, body: `${w.project.name} · ${formatINR(w.amount)}`, link: `/portal/projects/${w.project.id}` }, tx);
      await audit(c, { action: "UPDATE", entityType: "AdditionalWork", entityId: id, summary: `Sent extra work ${w.number} to the client for approval` }, tx);
    });
    refresh();
    return { message: "Sent to the client for approval" };
  });
}

/** The client agreed (or refused) outside the portal – by signed letter, e-mail or message. Approving needs that written proof. */
export async function recordClientDecision(id: string, approve: boolean, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("extra_work:edit");
    const w = await load(c, id);
    const lateEmergency = w.kind === "EMERGENCY" && ["IN_PROGRESS", "COMPLETED"].includes(w.status) && !w.decidedAt; // approval after the fact
    if (!BILLABLE.includes(w.kind)) throw new UserError("This kind of work does not need the client's approval.");
    if (!["DRAFT", "SENT"].includes(w.status) && !lateEmergency) throw new UserError("This has already been decided.");
    const who = String(fd.get("decidedByName") ?? "").trim();
    const note = String(fd.get("note") ?? "").trim();
    if (!who) throw new UserError("Enter the name of the person at the client who decided.");
    if (!approve && !note) throw new UserError("Write the reason the client gave.");
    let key: string | null = null;
    let doc: Awaited<ReturnType<typeof validateUpload>> | null = null;
    if (approve) {
      const f = fd.get("proof");
      if (!(f instanceof File) || f.size === 0) throw new UserError("Upload the client's written approval (signed letter, e-mail or message screenshot).");
      try {
        doc = await validateUpload(f);
      } catch (e) {
        if (e instanceof UploadError) throw new UserError(e.message);
        throw e;
      }
    }
    try {
      if (doc) key = await putFile(c.companyId, doc.bytes, doc.ext);
      await db.$transaction(async (tx) => {
        let docId: string | null = null;
        if (doc && key) {
          const d = await tx.document.create({ data: { companyId: c.companyId, name: `Written approval ${w.number}.${doc.ext}`, type: "CONTRACT", folder: "Extra work approvals", entityType: "PROJECT", entityId: w.project.id, storageKey: key, mimeType: doc.mime, size: doc.size, uploadedById: c.userId } });
          docId = d.id;
        }
        await tx.additionalWork.update({ where: { id }, data: { status: lateEmergency ? w.status : approve ? "APPROVED" : "REJECTED", decidedAt: new Date(), decidedByName: who, decisionVia: "RECORDED", decisionNote: note || null, approvalDocId: docId } });
        if (lateEmergency && approve) await resolveActionsFor(tx, c.companyId, "AdditionalWork", id, c.userId, "The client's written approval was recorded.");
        await audit(c, { action: approve ? "APPROVE" : "REJECT", entityType: "AdditionalWork", entityId: id, summary: `Recorded client ${approve ? "approval" : "refusal"} of extra work ${w.number} (${who})${note ? `: ${note}` : ""}` }, tx);
        if (approve) await notifyRoles(c.companyId, ["ACCOUNTS"], { type: "GENERAL", title: `Extra work approved: ${w.number} (${formatINR(w.amount)})`, body: `${w.project.code} – ${w.title}. Bill it when complete.`, link: "/extra-work" }, tx);
      });
    } catch (e) {
      if (key) await deleteFile(key);
      throw e;
    }
    refresh();
    return { message: approve ? "Client approval recorded – work can start" : "Recorded as declined by the client" };
  });
}

/** The lock: nothing outside the agreed scope starts without the client's approval. */
export async function startExtraWork(id: string) {
  return run(async () => {
    const c = await assertPerm("extra_work:edit");
    const w = await load(c, id);
    if (w.kind !== "CHARGEABLE") {
      if (!["DRAFT", "APPROVED"].includes(w.status)) throw new UserError("This work has already started.");
      if ((w.kind === "EMERGENCY" || w.kind === "CONCESSION") && !w.internalApprovedAt) throw new UserError(w.kind === "EMERGENCY" ? "Emergency work needs a director's approval before it starts (Owner, Management or Admin)." : "A concession needs a director's approval before it starts.");
    } else if (w.status !== "APPROVED") {
      throw new UserError(w.status === "IN_PROGRESS" || w.status === "COMPLETED" ? "This work has already started." : `Client approval is missing – extra work can't start. ${w.status === "REJECTED" ? "The client declined it." : "Send it to the client or record their written approval first."}`);
    }
    await db.$transaction(async (tx) => {
      await tx.additionalWork.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
      if (w.kind === "EMERGENCY" && !w.decidedAt && w.project.projectManagerId) {
        await raiseAction(tx, { companyId: c.companyId, title: `Get the client's written approval for emergency work ${w.number}`, severity: "HIGH", ownerId: w.project.projectManagerId, createdById: c.userId, projectId: w.project.id, dueDate: dueIn("MEDIUM"), detail: "The work started as an emergency. Record the client's written approval on the Extra work page.", sourceType: "AdditionalWork", sourceId: w.id, sourceLabel: w.number, link: "/extra-work" });
      }
      await notifyUsers([w.project.supervisorId, w.project.projectManagerId].filter((u): u is string => !!u && u !== c.userId), { companyId: c.companyId, type: "GENERAL", title: `Approved extra work can start: ${w.title}`, body: w.project.name, link: "/extra-work" }, tx);
      await audit(c, { action: "UPDATE", entityType: "AdditionalWork", entityId: id, summary: `Started approved extra work ${w.number}` }, tx);
    });
    refresh();
    return { message: "Extra work started" };
  });
}

export async function completeExtraWork(id: string) {
  return run(async () => {
    const c = await assertPerm("extra_work:edit");
    const w = await load(c, id);
    if (w.status !== "IN_PROGRESS") throw new UserError("Only work in progress can be completed.");
    await db.$transaction(async (tx) => {
      await tx.additionalWork.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
      if (BILLABLE.includes(w.kind)) await notifyRoles(c.companyId, ["ACCOUNTS"], { type: "PAYMENT_DUE", title: `Extra work completed – bill ${formatINR(w.amount)}`, body: `${w.project.code} – ${w.title} (${w.number}, client approved)`, link: "/finance/invoices/new", dedupeKey: `aw-done:${id}` }, tx);
      await audit(c, { action: "UPDATE", entityType: "AdditionalWork", entityId: id, summary: `Completed extra work ${w.number}` }, tx);
    });
    refresh();
    return { message: "Marked completed – Accounts will bill it" };
  });
}

/** A director approves emergency work and concessions before they start, with the reason on record. */
export async function approveExtraWorkInternally(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("extra_work:approve");
    const note = String(fd.get("note") ?? "").trim();
    if (note.length < 5) throw new UserError("Write the reason you are approving this (it is recorded).");
    const w = await load(c, id);
    if (w.kind !== "EMERGENCY" && w.kind !== "CONCESSION") throw new UserError("Only emergency work and concessions need a director's approval.");
    if (w.internalApprovedAt) throw new UserError("Already approved.");
    if (w.requestedById === c.userId && c.role !== "OWNER") throw new UserError("You raised this yourself: someone else must approve it.");
    await db.$transaction(async (tx) => {
      await tx.additionalWork.update({ where: { id }, data: { internalApprovedById: c.userId, internalApprovedAt: new Date(), internalNote: note } });
      await audit(c, { action: "APPROVE", entityType: "AdditionalWork", entityId: id, summary: `${c.name} approved ${w.kind.toLowerCase()} work ${w.number} (${formatINR(w.kind === "CONCESSION" ? w.amount : w.costEstimate)}): ${note}` }, tx);
      if (w.project.projectManagerId) await notifyUsers([w.project.projectManagerId], { companyId: c.companyId, type: "GENERAL", title: `${w.number} approved: ${w.title}`, body: "It can start.", link: "/extra-work" }, tx);
    });
    refresh();
    return { message: "Approved: the work can start" };
  });
}

/** After the work is done, the project manager checks and measures it. Billing uses this. */
export async function verifyExtraWork(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("extra_work:edit");
    const note = String(fd.get("note") ?? "").trim();
    if (note.length < 3) throw new UserError("Write what you measured or checked (quantities, photos, date).");
    const w = await load(c, id);
    if (w.status !== "COMPLETED") throw new UserError("Only completed work can be verified.");
    if (w.verifiedAt) throw new UserError("Already verified.");
    await db.additionalWork.update({ where: { id }, data: { verifiedAt: new Date(), verifiedById: c.userId, verifyNote: note } });
    await audit(c, { action: "UPDATE", entityType: "AdditionalWork", entityId: id, summary: `${c.name} verified completed extra work ${w.number}: ${note}` });
    refresh();
    return { message: "Verified" };
  });
}

/** Accounts ties the work to the invoice it was billed on, so nothing completed is left unbilled. */
export async function linkExtraWorkInvoice(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("invoices:create");
    const invoiceId = String(fd.get("invoiceId") ?? "").trim();
    if (!invoiceId) throw new UserError("Choose the invoice.");
    const w = await db.additionalWork.findFirst({ where: { id, companyId: c.companyId }, include: { project: { select: { id: true, code: true } } } });
    if (!w) throw new UserError("Extra work not found.");
    if (!BILLABLE.includes(w.kind)) throw new UserError("This kind of work is never billed.");
    if (w.status !== "COMPLETED") throw new UserError("Only completed work is billed.");
    if (w.kind === "EMERGENCY" && !w.decidedAt) throw new UserError("The client's written approval of this emergency work has not been recorded yet.");
    const inv = await db.invoice.findFirst({ where: { id: invoiceId, companyId: c.companyId, deletedAt: null, projectId: w.projectId } });
    if (!inv) throw new UserError("That invoice is not on this project.");
    await db.additionalWork.update({ where: { id }, data: { billedInvoiceId: inv.id } });
    await audit(c, { action: "UPDATE", entityType: "AdditionalWork", entityId: id, summary: `${c.name} linked extra work ${w.number} to invoice ${inv.number}` });
    revalidatePath("/extra-work");
    return { message: `Linked to ${inv.number}` };
  });
}
