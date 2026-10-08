"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TicketStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { notifyUsers } from "@/lib/notify";
import { openTicket, ticketSchema } from "@/lib/tickets";
import { formToObject, zOptStr, zReqStr } from "@/lib/form";
import { humanize } from "@/lib/utils";

export async function createTicket(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("support:create");
    const d = ticketSchema.parse(formToObject(fd));
    const t = await openTicket(c, d);
    revalidatePath("/support");
    return { message: `Ticket ${t.number} opened`, data: { id: t.id } };
  });
}

export async function updateTicket(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("support:edit");
    const d = ticketSchema.omit({ clientId: true, projectId: true }).parse(formToObject(fd));
    const t = await db.supportTicket.findFirst({ where: { id, companyId: c.companyId } });
    if (!t) throw new UserError("Ticket not found.");
    const reassigned = d.assignedToId && d.assignedToId !== t.assignedToId;
    await db.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id }, data: { subject: d.subject, description: d.description, priority: d.priority, assignedToId: d.assignedToId ?? null, status: reassigned && t.status === "OPEN" ? "ASSIGNED" : t.status } });
      await audit(c, { action: "UPDATE", entityType: "SupportTicket", entityId: id, summary: `Updated ticket ${t.number}${reassigned ? " (reassigned)" : ""}` }, tx);
      if (reassigned && d.assignedToId !== c.userId) await notifyUsers([d.assignedToId!], { companyId: c.companyId, type: "SUPPORT_TICKET", title: `Ticket assigned to you: ${d.subject}`, link: `/support/${id}` }, tx);
    });
    revalidatePath("/support");
    revalidatePath(`/support/${id}`);
    return { message: "Ticket updated" };
  });
}

const FLOW: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["ASSIGNED", "IN_PROGRESS", "WAITING", "RESOLVED"],
  ASSIGNED: ["IN_PROGRESS", "WAITING", "RESOLVED", "OPEN"],
  IN_PROGRESS: ["WAITING", "RESOLVED", "ASSIGNED"],
  WAITING: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
};

export async function setTicketStatus(id: string, status: string, fd?: FormData) {
  return run(async () => {
    const c = await assertPerm("support:edit");
    const s = z.nativeEnum(TicketStatus).parse(status);
    const t = await db.supportTicket.findFirst({ where: { id, companyId: c.companyId }, include: { client: true } });
    if (!t) throw new UserError("Ticket not found.");
    if (t.status === s) return { message: "No change" };
    if (!FLOW[t.status].includes(s)) throw new UserError(`A ${humanize(t.status).toLowerCase()} ticket can't move to ${humanize(s).toLowerCase()}.`);
    const resolution = (fd ? String(fd.get("resolution") ?? "").trim() : "") || t.resolution || "";
    if ((s === "RESOLVED" || s === "CLOSED") && !resolution) throw new UserError("Describe how the issue was resolved first.");
    await db.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id }, data: { status: s, resolution: resolution || null } });
      await audit(c, { action: "UPDATE", entityType: "SupportTicket", entityId: id, summary: `Ticket ${t.number}: ${humanize(t.status)} → ${humanize(s)}` }, tx);
    });
    revalidatePath("/support");
    revalidatePath(`/support/${id}`);
    return { message: `Marked ${humanize(s).toLowerCase()}` };
  });
}

const claimSchema = z.object({ item: zReqStr("What is being claimed?"), notes: zOptStr });

export async function addWarrantyClaim(ticketId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("support:edit");
    const d = claimSchema.parse(formToObject(fd));
    const t = await db.supportTicket.findFirst({ where: { id: ticketId, companyId: c.companyId } });
    if (!t) throw new UserError("Ticket not found.");
    if (!t.isWarranty) throw new UserError("This ticket isn't under warranty. Mark it as a warranty ticket first if it should be.");
    await db.warrantyClaim.create({ data: { companyId: c.companyId, ticketId, item: d.item, notes: d.notes } });
    await audit(c, { action: "CREATE", entityType: "WarrantyClaim", entityId: ticketId, summary: `Warranty claim added on ${t.number}: ${d.item}` });
    revalidatePath(`/support/${ticketId}`);
    return { message: "Claim added" };
  });
}

export async function decideWarrantyClaim(claimId: string, approved: boolean, fd?: FormData) {
  return run(async () => {
    const c = await assertPerm("support:approve");
    const cl = await db.warrantyClaim.findFirst({ where: { id: claimId, companyId: c.companyId }, include: { ticket: true } });
    if (!cl) throw new UserError("Claim not found.");
    if (cl.approved !== null) throw new UserError("This claim has already been decided.");
    const note = fd ? String(fd.get("notes") ?? "").trim() : "";
    if (!approved && !note) throw new UserError("Please say why the claim is declined.");
    await db.warrantyClaim.update({ where: { id: claimId }, data: { approved, notes: note ? `${cl.notes ? cl.notes + "\n" : ""}${approved ? "Approved" : "Declined"}: ${note}` : cl.notes } });
    await audit(c, { action: approved ? "APPROVE" : "REJECT", entityType: "WarrantyClaim", entityId: claimId, summary: `${approved ? "Approved" : "Declined"} warranty claim “${cl.item}” on ${cl.ticket.number}${note ? ` – ${note}` : ""}` });
    if (cl.ticket.assignedToId && cl.ticket.assignedToId !== c.userId) await notifyUsers([cl.ticket.assignedToId], { companyId: c.companyId, type: "SUPPORT_TICKET", title: `Warranty claim ${approved ? "approved" : "declined"}: ${cl.item}`, link: `/support/${cl.ticketId}` });
    revalidatePath(`/support/${cl.ticketId}`);
    return { message: approved ? "Claim approved" : "Claim declined" };
  });
}

export async function toggleWarranty(id: string) {
  return run(async () => {
    const c = await assertPerm("support:approve");
    const t = await db.supportTicket.findFirst({ where: { id, companyId: c.companyId } });
    if (!t) throw new UserError("Ticket not found.");
    await db.supportTicket.update({ where: { id }, data: { isWarranty: !t.isWarranty } });
    await audit(c, { action: "UPDATE", entityType: "SupportTicket", entityId: id, summary: `Ticket ${t.number} marked ${t.isWarranty ? "not under warranty" : "under warranty"} (manual override)` });
    revalidatePath(`/support/${id}`);
    return { message: t.isWarranty ? "Marked as chargeable" : "Marked as under warranty" };
  });
}
