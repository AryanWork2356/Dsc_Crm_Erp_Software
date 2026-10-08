"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCtx, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { openTicket } from "@/lib/tickets";
import { formToObject, zOptStr, zReqStr } from "@/lib/form";
import { Priority } from "@prisma/client";

/** Every portal action is limited to the signed-in client's OWN data. */
async function clientCtx(): Promise<Ctx & { clientId: string }> {
  const c = await getCtx();
  if (!c || c.role !== "CLIENT" || !c.clientId) throw new UserError("Please sign in with your client account.");
  return c as Ctx & { clientId: string };
}

export async function approveMilestone(id: string) {
  return run(async () => {
    const c = await clientCtx();
    const m = await db.projectMilestone.findFirst({ where: { id, companyId: c.companyId, project: { clientId: c.clientId, deletedAt: null } }, include: { project: true } });
    if (!m) throw new UserError("Milestone not found.");
    if (!m.completedAt) throw new UserError("This stage hasn't been marked complete yet.");
    if (m.clientApproved) throw new UserError("You've already approved this stage.");
    await db.$transaction(async (tx) => {
      await tx.projectMilestone.update({ where: { id }, data: { clientApproved: true } });
      await audit(c, { action: "APPROVE", entityType: "ProjectMilestone", entityId: id, summary: `Client ${c.name} approved milestone “${m.name}” of ${m.project.code}` }, tx);
      await notifyUsers([m.project.projectManagerId].filter((u): u is string => !!u), { companyId: c.companyId, type: "GENERAL", title: `Client approved “${m.name}”`, body: m.project.name, link: `/projects/${m.project.id}?tab=milestones` }, tx);
      if (Number(m.billingPct) > 0) await notifyRoles(c.companyId, ["ACCOUNTS"], { type: "PAYMENT_DUE", title: `Stage approved by client: ${m.name}`, body: `${m.project.name} – you can now invoice ${Number(m.billingPct)}%.`, link: `/projects/${m.project.id}?tab=milestones`, dedupeKey: `ms-approved:${id}` }, tx);
    });
    revalidatePath("/portal");
    return { message: "Thank you – stage approved" };
  });
}

export async function respondToQuotation(id: string, decision: "ACCEPT" | "CHANGES", fd?: FormData) {
  return run(async () => {
    const c = await clientCtx();
    const note = (fd ? String(fd.get("note") ?? "") : "").trim();
    const q = await db.quotation.findFirst({ where: { id, companyId: c.companyId, clientId: c.clientId, deletedAt: null, status: { in: ["SENT", "VIEWED", "NEGOTIATION"] } } });
    if (!q) throw new UserError("This quotation isn't available to respond to.");
    if (decision === "CHANGES" && !note) throw new UserError("Please tell us what you'd like changed.");
    await db.$transaction(async (tx) => {
      if (decision === "ACCEPT") {
        await tx.quotation.update({ where: { id }, data: { status: "ACCEPTED" } });
        if (q.leadId) {
          await tx.lead.update({ where: { id: q.leadId }, data: { stage: "WON", clientId: q.clientId } });
          await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: q.leadId, kind: "STAGE_CHANGE", body: `Client accepted quotation ${q.number} from the portal → Won` } });
        }
      } else {
        await tx.quotation.update({ where: { id }, data: { status: "NEGOTIATION", notes: `${q.notes ? q.notes + "\n" : ""}Client request (${new Date().toLocaleDateString("en-IN")}): ${note}` } });
        if (q.leadId) await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: q.leadId, kind: "NOTE", body: `Client asked for changes on ${q.number}: ${note}` } });
      }
      await audit(c, { action: decision === "ACCEPT" ? "APPROVE" : "UPDATE", entityType: "Quotation", entityId: id, summary: `Client ${c.name} ${decision === "ACCEPT" ? "accepted" : "requested changes to"} quotation ${q.number}${note ? ` – ${note}` : ""}` }, tx);
      const sales = q.preparedById ? [q.preparedById] : [];
      await notifyUsers(sales, { companyId: c.companyId, type: "GENERAL", title: decision === "ACCEPT" ? `🎉 ${q.number} accepted by the client` : `Client wants changes on ${q.number}`, body: note || undefined, link: `/sales/quotations/${id}` }, tx);
      await notifyRoles(c.companyId, ["MANAGEMENT"], { type: "GENERAL", title: decision === "ACCEPT" ? `${q.number} accepted by the client` : `Client wants changes on ${q.number}`, link: `/sales/quotations/${id}`, dedupeKey: `portal-q:${id}:${decision}` }, tx);
    });
    revalidatePath("/portal/quotations");
    return { message: decision === "ACCEPT" ? "Thank you! Our team will be in touch to start your project." : "Thanks – we'll revise the quotation and get back to you." };
  });
}

export async function createClientTicket(fd: FormData) {
  return run(async () => {
    const c = await clientCtx();
    const d = z.object({ projectId: zOptStr, subject: zReqStr("Tell us briefly what the issue is"), description: zOptStr, priority: z.nativeEnum(Priority).default("MEDIUM") }).parse(formToObject(fd));
    const t = await openTicket(c, { clientId: c.clientId, projectId: d.projectId, subject: d.subject, description: d.description, priority: d.priority, assignedToId: undefined });
    revalidatePath("/portal/support");
    return { message: `Request ${t.number} received. We'll be in touch soon.` };
  });
}
