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

const schema = z.object({
  projectId: zReqStr("Choose the project"),
  title: zReqStr("Say what the extra work is"),
  description: zOptStr,
  amount: zNumPos(),
});

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
    const p = await db.project.findFirst({ where: { id: d.projectId, ...projectScope(c) } });
    if (!p) throw new UserError("Project not found or you aren't on it.");
    if (["COMPLETED", "CANCELLED"].includes(p.status)) throw new UserError("This project is closed.");
    const w = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, c.companyId, "AW");
      const x = await tx.additionalWork.create({ data: { companyId: c.companyId, number, projectId: p.id, title: d.title, description: d.description, amount: d.amount, requestedById: c.userId } });
      await audit(c, { action: "CREATE", entityType: "AdditionalWork", entityId: x.id, summary: `Raised extra work ${number} on ${p.code}: ${d.title} (${formatINR(d.amount)})` }, tx);
      if (p.projectManagerId && p.projectManagerId !== c.userId) await notifyUsers([p.projectManagerId], { companyId: c.companyId, type: "GENERAL", title: `Extra work ${number} raised on ${p.code}`, body: d.title, link: "/extra-work" }, tx);
      return x;
    });
    refresh();
    return { message: `Extra work ${w.number} saved as a draft`, data: { id: w.id } };
  });
}

export async function sendExtraWork(id: string) {
  return run(async () => {
    const c = await assertPerm("extra_work:edit");
    const w = await load(c, id);
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
    if (!["DRAFT", "SENT"].includes(w.status)) throw new UserError("This has already been decided.");
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
        await tx.additionalWork.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedAt: new Date(), decidedByName: who, decisionVia: "RECORDED", decisionNote: note || null, approvalDocId: docId } });
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
    if (w.status !== "APPROVED") {
      throw new UserError(w.status === "IN_PROGRESS" || w.status === "COMPLETED" ? "This work has already started." : `Client approval is missing – extra work can't start. ${w.status === "REJECTED" ? "The client declined it." : "Send it to the client or record their written approval first."}`);
    }
    await db.$transaction(async (tx) => {
      await tx.additionalWork.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
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
      await notifyRoles(c.companyId, ["ACCOUNTS"], { type: "PAYMENT_DUE", title: `Extra work completed – bill ${formatINR(w.amount)}`, body: `${w.project.code} – ${w.title} (${w.number}, client approved)`, link: "/finance/invoices/new", dedupeKey: `aw-done:${id}` }, tx);
      await audit(c, { action: "UPDATE", entityType: "AdditionalWork", entityId: id, summary: `Completed extra work ${w.number}` }, tx);
    });
    refresh();
    return { message: "Marked completed – Accounts will bill it" };
  });
}
