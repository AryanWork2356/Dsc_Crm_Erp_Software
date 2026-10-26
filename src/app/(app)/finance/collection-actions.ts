"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { raiseAction, resolveActionsFor } from "@/lib/action-items";
import { formToObject, zOptDate, zOptStr, zReqStr } from "@/lib/form";
import { num } from "@/lib/utils";

const schema = z.object({
  channel: z.enum(["CALL", "WHATSAPP", "EMAIL", "VISIT", "OTHER"]).default("CALL"),
  note: zReqStr("Write what was said"),
  promisedAmount: z.coerce.number().positive().optional(),
  promisedDate: zOptDate,
  nextAction: zOptStr,
  nextActionDate: zOptDate,
  ownerId: zOptStr,
});

/**
 * Records one follow-up on an unpaid invoice. "Client will pay soon" is not enough: a next action with a date and an owner is
 * required while money is still due. A promised date is only a promise: it never marks the invoice paid (only a recorded
 * payment does). The next follow-up becomes ONE action for the owner; recording a new follow-up replaces the old one.
 */
export async function addCollectionNote(invoiceId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("invoices:edit");
    const d = schema.parse(formToObject(fd));
    const inv = await db.invoice.findFirst({ where: { id: invoiceId, companyId: c.companyId, deletedAt: null }, include: { client: { select: { name: true } } } });
    if (!inv) throw new UserError("Invoice not found.");
    if (!["SENT", "PARTIALLY_PAID", "OVERDUE", "PAID"].includes(inv.status)) throw new UserError("Follow-ups are for invoices that have been issued.");
    const due = num(inv.total) - num(inv.paid);
    const stillDue = due > 0.5;
    if (stillDue && !d.nextActionDate) throw new UserError("Give the date of the next follow-up. “Will pay soon” is not a plan: say who does what, and when.");
    if (stillDue && !(d.nextAction ?? "").trim()) throw new UserError("Say what the next follow-up is (call the accounts head, send a reminder, visit …).");
    if (d.nextActionDate && d.nextActionDate.getTime() < Date.now() - 86400000) throw new UserError("The next follow-up date has already passed.");
    if (d.promisedDate && d.promisedDate.getTime() < Date.now() - 86400000) throw new UserError("The promised date has already passed. Enter the new date the client gave.");
    const ownerId = d.ownerId ?? c.userId;
    if (!(await db.user.findFirst({ where: { id: ownerId, companyId: c.companyId, isActive: true, deletedAt: null, role: { notIn: ["CLIENT", "VENDOR", "WORKER"] } }, select: { id: true } }))) throw new UserError("Choose someone from your team to follow up.");

    await db.$transaction(async (tx) => {
      await tx.collectionNote.create({ data: { companyId: c.companyId, invoiceId, channel: d.channel, note: d.note, promisedAmount: d.promisedAmount ?? null, promisedDate: d.promisedDate ?? null, nextAction: d.nextAction ?? null, nextActionDate: d.nextActionDate ?? null, ownerId, createdById: c.userId } });
      await resolveActionsFor(tx, c.companyId, "Invoice", invoiceId, c.userId, "A newer follow-up was recorded.");
      if (stillDue && d.nextActionDate) {
        const end = new Date(d.nextActionDate);
        end.setUTCHours(23, 59, 0, 0);
        await raiseAction(tx, { companyId: c.companyId, title: `Follow up ${inv.number} (${inv.client.name}): ${d.nextAction}`, severity: "MEDIUM", ownerId, createdById: c.userId, projectId: inv.projectId, dueDate: end, detail: `₹${due.toLocaleString("en-IN")} still to collect.${d.promisedDate ? ` Promised for ${d.promisedDate.toLocaleDateString("en-IN")}.` : ""}`, sourceType: "Invoice", sourceId: invoiceId, sourceLabel: inv.number, link: `/finance/invoices/${invoiceId}` });
      }
      await audit(c, { action: "CREATE", entityType: "CollectionNote", entityId: invoiceId, summary: `${c.name} followed up ${inv.number} (${inv.client.name}) by ${d.channel.toLowerCase()}: ${d.note}${d.promisedDate ? ` · promised ${d.promisedDate.toISOString().slice(0, 10)}` : ""}` }, tx);
    });
    revalidatePath(`/finance/invoices/${invoiceId}`);
    revalidatePath("/finance/receivables");
    return { message: stillDue ? "Follow-up recorded. The next one is on the owner's list." : "Recorded" };
  });
}
