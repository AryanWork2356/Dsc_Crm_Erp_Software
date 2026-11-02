"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { run, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { projectScope } from "@/lib/scope";
import { TRADES, tradeLabel } from "@/lib/trades";
import { isRemarkStaff, remarkScope } from "@/lib/remarks";
import { formToObject } from "@/lib/form";

async function signedIn() {
  const c = await getCtx();
  if (!c) throw new UserError("Please sign in again.");
  return c;
}

const text = z.string().trim().min(2, "Write the remark first").max(4000);
const newRemark = z.object({ projectId: z.string().min(1, "Choose the project"), trade: z.string().optional(), body: text });

/** A coordinator's remark (for example "the painter is not answering"): the admins are told and answer in the same thread. */
export async function createRemark(fd: FormData) {
  return run(async () => {
    const c = await signedIn();
    const d = newRemark.parse(formToObject(fd));
    const project = await db.project.findFirst({ where: { id: d.projectId, ...projectScope(c) }, select: { id: true, code: true, name: true } });
    if (!project) throw new UserError("Project not found or you are not on it.");
    const trade = d.trade && TRADES.some((t) => t.key === d.trade) ? d.trade : null;
    const pv = trade ? await db.projectVendor.findUnique({ where: { projectId_trade: { projectId: project.id, trade } }, select: { vendorId: true } }) : null;
    const r = await db.$transaction(async (tx) => {
      const x = await tx.remark.create({ data: { companyId: c.companyId, projectId: project.id, trade, vendorId: pv?.vendorId ?? null, subject: d.body.replace(/\s+/g, " ").slice(0, 120), createdById: c.userId, messages: { create: { userId: c.userId, body: d.body } } } });
      await audit(c, { action: "CREATE", entityType: "Remark", entityId: x.id, summary: `${c.name} sent a remark on ${project.code}${trade ? ` (${tradeLabel(trade)})` : ""}` }, tx);
      await notifyRoles(c.companyId, ["ADMIN"], { type: "GENERAL", title: `Remark from ${c.name}: ${project.code}${trade ? ` â€“ ${tradeLabel(trade)}` : ""}`, body: d.body.slice(0, 300), link: `/remarks/${x.id}` }, tx);
      return x;
    });
    revalidatePath("/remarks");
    return { message: "Remark sent. The admins have been told.", data: { id: r.id } };
  });
}

/** A reply in the thread. Admins/directors reply to the coordinator; the coordinator's replies go back to the admins. */
export async function replyRemark(id: string, body: string) {
  return run(async () => {
    const c = await signedIn();
    const b = text.parse(body);
    const r = await db.remark.findFirst({ where: { id, ...remarkScope(c) }, include: { project: { select: { code: true } } } });
    if (!r) throw new UserError("Remark not found.");
    const staff = isRemarkStaff(c);
    if (!staff && r.createdById !== c.userId) throw new UserError("Only the person who wrote the remark and the admins can reply.");
    await db.$transaction(async (tx) => {
      await tx.remarkMessage.create({ data: { remarkId: id, userId: c.userId, body: b } });
      await tx.remark.update({ where: { id }, data: { updatedAt: new Date(), ...(r.status === "RESOLVED" && !staff ? { status: "OPEN", resolvedAt: null } : {}) } });
      const n = { companyId: c.companyId, type: "GENERAL" as const, title: `${c.name} replied: ${r.project?.code ?? "remark"}`, body: b.slice(0, 300), link: `/remarks/${id}` };
      if (staff && r.createdById !== c.userId) await notifyUsers([r.createdById], n, tx);
      else await notifyRoles(c.companyId, ["ADMIN"], n, tx);
    });
    revalidatePath(`/remarks/${id}`);
    revalidatePath("/remarks");
    return { message: "Sent" };
  });
}

/** Mark sorted (or open again). Directors, admins, or the person who wrote it. */
export async function setRemarkResolved(id: string, resolved: boolean) {
  return run(async () => {
    const c = await signedIn();
    const r = await db.remark.findFirst({ where: { id, ...remarkScope(c) } });
    if (!r) throw new UserError("Remark not found.");
    if (!isRemarkStaff(c) && r.createdById !== c.userId) throw new UserError("Only the admins or the person who wrote it can close it.");
    await db.remark.update({ where: { id }, data: { status: resolved ? "RESOLVED" : "OPEN", resolvedAt: resolved ? new Date() : null } });
    if (resolved && r.createdById !== c.userId) await notifyUsers([r.createdById], { companyId: c.companyId, type: "GENERAL", title: `Remark sorted by ${c.name}`, body: r.subject, link: `/remarks/${id}` });
    revalidatePath(`/remarks/${id}`);
    revalidatePath("/remarks");
    return { message: resolved ? "Marked sorted" : "Opened again" };
  });
}
