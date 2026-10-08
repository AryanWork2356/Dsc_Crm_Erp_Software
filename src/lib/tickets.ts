import "server-only";
import { z } from "zod";
import { Priority } from "@prisma/client";
import { db } from "./db";
import type { Ctx } from "./auth";
import { audit } from "./audit";
import { UserError } from "./action";
import { nextNumber } from "./sequence";
import { notifyUsers, notifyRoles } from "./notify";
import { inWarranty } from "./warranty";
import { zOptStr, zReqStr } from "./form";

export const ticketSchema = z.object({
  clientId: zReqStr("Select the client"),
  projectId: zOptStr,
  subject: zReqStr("Give the issue a short title"),
  description: zOptStr,
  priority: z.nativeEnum(Priority).default("MEDIUM"),
  assignedToId: zOptStr,
});

/** Shared by staff and the client portal: creates the ticket, works out warranty cover and alerts the right people. */
export async function openTicket(c: Pick<Ctx, "companyId" | "userId" | "name">, d: z.infer<typeof ticketSchema>) {
  const client = await db.client.findFirst({ where: { id: d.clientId, companyId: c.companyId, deletedAt: null } });
  if (!client) throw new UserError("Client not found.");
  const project = d.projectId ? await db.project.findFirst({ where: { id: d.projectId, companyId: c.companyId, clientId: d.clientId, deletedAt: null } }) : null;
  if (d.projectId && !project) throw new UserError("That project doesn't belong to this client.");
  const warranty = project ? inWarranty(project) : false;
  const ticket = await db.$transaction(async (tx) => {
    const number = await nextNumber(tx, c.companyId, "TKT");
    const assignedToId = d.assignedToId ?? project?.projectManagerId ?? null;
    const t = await tx.supportTicket.create({ data: { companyId: c.companyId, number, clientId: d.clientId, projectId: d.projectId ?? null, subject: d.subject, description: d.description, priority: d.priority, isWarranty: warranty, assignedToId, status: assignedToId ? "ASSIGNED" : "OPEN" } });
    await audit(c, { action: "CREATE", entityType: "SupportTicket", entityId: t.id, summary: `Ticket ${number} opened for ${client.name}: ${d.subject}${warranty ? " (under warranty)" : ""}` }, tx);
    if (assignedToId && assignedToId !== c.userId) await notifyUsers([assignedToId], { companyId: c.companyId, type: "SUPPORT_TICKET", title: `New ticket ${number}: ${d.subject}`, body: `${client.name}${warranty ? " · under warranty" : ""}`, link: `/support/${t.id}` }, tx);
    else if (!assignedToId) await notifyRoles(c.companyId, ["MANAGEMENT", "ADMIN"], { type: "SUPPORT_TICKET", title: `Unassigned ticket ${number}: ${d.subject}`, link: `/support/${t.id}`, dedupeKey: `tkt-new:${t.id}` }, tx);
    return t;
  });
  return ticket;
}

