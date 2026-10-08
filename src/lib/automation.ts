import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { notifyRoles, notifyUsers } from "./notify";
import { autoMessage, loadWaConfig, isConnected } from "./whatsapp";
import { calendarDay, formatDate, formatINR, num, startOfDay } from "./utils";

/**
 * Time-based automation. Every rule is idempotent (de-duplicated by `dedupeKey`), so the engine can run from a
 * scheduler (/api/cron/daily), lazily when someone opens the dashboard, or manually from Settings → Automation
 * as often as needed without spamming anyone.
 *
 * Event-based rules (lead assigned, approval decided, material received, low stock…) live next to the actions that fire them.
 */

export type AutomationResult = Record<string, number>;
const DAY = 86400000;

/** Quotations past their validity date are marked Expired. */
export async function expireQuotations(companyId: string) {
  const r = await db.quotation.updateMany({
    where: { companyId, deletedAt: null, status: { in: ["SENT", "VIEWED", "NEGOTIATION"] }, validUntil: { lt: startOfDay() } },
    data: { status: "EXPIRED" },
  });
  return r.count;
}

export async function runDailyAutomations(companyId: string): Promise<AutomationResult> {
  const today = startOfDay();
  const tomorrow = new Date(today.getTime() + DAY);
  const dayKey = calendarDay().toISOString().slice(0, 10);
  const out: AutomationResult = {};

  // 1. quotations expire
  out.quotationsExpired = await expireQuotations(companyId);

  // 2. invoices: overdue status + reminders
  const overdueNow = await db.invoice.findMany({ where: { companyId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: today } }, include: { client: true } });
  const unpaidOverdue = overdueNow.filter((i) => num(i.paid) === 0);
  if (unpaidOverdue.length) await db.invoice.updateMany({ where: { id: { in: unpaidOverdue.map((i) => i.id) } }, data: { status: "OVERDUE" } });
  const allOverdue = await db.invoice.findMany({ where: { companyId, deletedAt: null, status: { in: ["OVERDUE", "PARTIALLY_PAID", "SENT"] }, dueDate: { lt: today } }, include: { client: true } });
  const owed = allOverdue.reduce((s, i) => s + num(i.total) - num(i.paid), 0);
  if (allOverdue.length) await notifyRoles(companyId, ["ACCOUNTS", "OWNER", "MANAGEMENT"], { type: "INVOICE_OVERDUE", title: `${allOverdue.length} overdue invoice(s) – ${formatINR(owed)} to collect`, body: allOverdue.slice(0, 3).map((i) => `${i.number} (${i.client.name})`).join(", "), link: "/finance/receivables", dedupeKey: `overdue:${dayKey}` });
  out.invoicesOverdue = allOverdue.length;

  const soon = await db.invoice.findMany({ where: { companyId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { gte: today, lt: new Date(today.getTime() + 4 * DAY) } }, include: { client: true } });
  for (const i of soon) await notifyRoles(companyId, ["ACCOUNTS"], { type: "PAYMENT_DUE", title: `Invoice ${i.number} is due ${formatDate(i.dueDate)}`, body: `${i.client.name} – ${formatINR(num(i.total) - num(i.paid))}`, link: `/finance/invoices/${i.id}`, dedupeKey: `inv-due:${i.id}` });
  out.invoicesDueSoon = soon.length;

  // WhatsApp payment reminders (only when connected + auto messages on), at most one per invoice per 7 days
  const wa = await loadWaConfig(companyId);
  let reminders = 0;
  if (isConnected(wa) && wa.autoMessages) {
    for (const i of allOverdue) {
      const recent = await db.whatsAppMessage.findFirst({ where: { template: "payment_reminder", body: { contains: i.number }, createdAt: { gte: new Date(Date.now() - 7 * DAY) } } });
      if (recent) continue;
      await autoMessage(companyId, i.client.phone, "payment_reminder", { name: i.client.name.split(" ")[0], number: i.number, amount: (num(i.total) - num(i.paid)).toLocaleString("en-IN"), date: formatDate(i.dueDate) }, { clientId: i.clientId });
      reminders++;
    }
  }
  out.whatsappReminders = reminders;

  // 3. lead follow-ups due today or overdue → one summary per salesperson per day
  const due = await db.lead.findMany({ where: { companyId, deletedAt: null, assignedToId: { not: null }, nextFollowUp: { lt: tomorrow }, stage: { notIn: ["WON", "LOST", "ON_HOLD"] } }, select: { assignedToId: true, name: true, nextFollowUp: true } });
  const byUser = new Map<string, typeof due>();
  for (const l of due) byUser.set(l.assignedToId!, [...(byUser.get(l.assignedToId!) ?? []), l]);
  for (const [uid, list] of byUser) {
    const late = list.filter((l) => l.nextFollowUp! < today).length;
    await notifyUsers([uid], { companyId, type: "FOLLOW_UP", title: `${list.length} follow-up(s) due${late ? ` (${late} overdue)` : " today"}`, body: list.slice(0, 3).map((l) => l.name).join(", "), link: "/crm/follow-ups", dedupeKey: `fu:${uid}:${dayKey}` });
  }
  out.followUpUsersNotified = byUser.size;

  // 4. purchase orders past their delivery date (once per PO)
  const latePos = await db.purchaseOrder.findMany({ where: { companyId, status: { in: ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] }, deliveryDate: { lt: today } }, include: { vendor: true } });
  for (const p of latePos) await notifyRoles(companyId, ["PROCUREMENT"], { type: "PO_PENDING", title: `${p.number} delivery is overdue`, body: `${p.vendor.name} promised ${formatDate(p.deliveryDate)}`, link: `/procurement/orders/${p.id}`, dedupeKey: `po-late:${p.id}` });
  out.latePurchaseOrders = latePos.length;

  // 5. project deadlines (approaching within 7 days / passed) → project manager
  const projects = await db.project.findMany({ where: { companyId, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED", "ON_HOLD"] }, plannedEndDate: { not: null, lt: new Date(today.getTime() + 8 * DAY) }, projectManagerId: { not: null } } });
  for (const p of projects) {
    const late = p.plannedEndDate! < today;
    await notifyUsers([p.projectManagerId!], { companyId, type: "PROJECT_DEADLINE", title: late ? `${p.name} is past its deadline` : `${p.name} is due ${formatDate(p.plannedEndDate)}`, body: `${p.progress}% complete`, link: `/projects/${p.id}`, dedupeKey: `proj-${late ? "late" : "soon"}:${p.id}` });
  }
  out.projectDeadlines = projects.length;

  // 6. tasks due tomorrow / overdue → one summary per assignee per day
  const tasks = await db.projectTask.findMany({ where: { companyId, status: { not: "COMPLETED" }, assignedToId: { not: null }, dueDate: { lt: new Date(today.getTime() + 2 * DAY) } }, select: { assignedToId: true, name: true, dueDate: true } });
  const tByUser = new Map<string, typeof tasks>();
  for (const t of tasks) tByUser.set(t.assignedToId!, [...(tByUser.get(t.assignedToId!) ?? []), t]);
  for (const [uid, list] of tByUser) {
    const late = list.filter((t) => t.dueDate! < today).length;
    await notifyUsers([uid], { companyId, type: "TASK_DEADLINE", title: `${list.length} task(s) need attention${late ? ` – ${late} overdue` : ""}`, body: list.slice(0, 3).map((t) => t.name).join(", "), link: "/projects/tasks", dedupeKey: `tasks:${uid}:${dayKey}` });
  }
  out.taskUsersNotified = tByUser.size;

  // 7. vendor bills due soon / overdue → accounts (daily summary)
  const bills = await db.vendorBill.findMany({ where: { companyId, status: { in: ["UNPAID", "PARTIALLY_PAID"] }, dueDate: { lt: new Date(today.getTime() + 4 * DAY) } }, include: { vendor: true } });
  if (bills.length) await notifyRoles(companyId, ["ACCOUNTS"], { type: "PAYMENT_DUE", title: `${bills.length} vendor bill(s) due or overdue`, body: bills.slice(0, 3).map((b) => `${b.vendor.name} ${formatINR(num(b.amount) - num(b.paid))}`).join(", "), link: "/finance/payables", dedupeKey: `bills:${dayKey}` });
  out.vendorBillsDue = bills.length;

  // 8. documents expiring within 30 days (once per document)
  const docs = await db.document.findMany({ where: { companyId, deletedAt: null, expiresAt: { not: null, lt: new Date(today.getTime() + 31 * DAY) } } });
  for (const d of docs) {
    const when = d.expiresAt! < today ? "has expired" : `expires ${formatDate(d.expiresAt)}`;
    await notifyRoles(companyId, ["ADMIN", "HR"], { type: "DOCUMENT_EXPIRY", title: `“${d.name}” ${when}`, link: "/documents?expiring=1", dedupeKey: `doc-exp:${d.id}` });
    if (d.uploadedById) await notifyUsers([d.uploadedById], { companyId, type: "DOCUMENT_EXPIRY", title: `“${d.name}” ${when}`, link: "/documents?expiring=1", dedupeKey: `doc-exp:${d.id}` });
  }
  out.documentsExpiring = docs.length;

  // 9. unassigned leads → management (daily summary)
  const unassigned = await db.lead.count({ where: { companyId, deletedAt: null, assignedToId: null, stage: { notIn: ["WON", "LOST"] } } });
  if (unassigned) await notifyRoles(companyId, ["ADMIN", "MANAGEMENT"], { type: "GENERAL", title: `${unassigned} lead(s) have no owner`, link: "/crm/leads", dedupeKey: `unassigned:${dayKey}` });
  out.unassignedLeads = unassigned;

  // remember the run
  const s = await db.companySettings.findUnique({ where: { companyId } });
  const prefs = (s?.notificationPrefs && typeof s.notificationPrefs === "object" ? s.notificationPrefs : {}) as Record<string, unknown>;
  const next = { ...prefs, lastDailyRun: new Date().toISOString(), lastDailyResult: out } as Prisma.InputJsonValue;
  await db.companySettings.upsert({ where: { companyId }, update: { notificationPrefs: next }, create: { companyId, notificationPrefs: next } });
  return out;
}

/** Runs the daily rules at most once per calendar day, triggered by whoever opens the dashboard first. */
export async function maybeRunDaily(companyId: string) {
  const s = await db.companySettings.findUnique({ where: { companyId } });
  const prefs = (s?.notificationPrefs && typeof s.notificationPrefs === "object" ? s.notificationPrefs : {}) as { lastDailyRun?: string };
  if (prefs.lastDailyRun && new Date(prefs.lastDailyRun) >= startOfDay()) return null;
  try {
    return await runDailyAutomations(companyId);
  } catch (e) {
    console.error("daily automation failed", e); // never break the page that triggered it
    return null;
  }
}
