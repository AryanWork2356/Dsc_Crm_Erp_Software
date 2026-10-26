import "server-only";
import type { RoleKey } from "@prisma/client";
import { db } from "./db";
import type { PermissionKey } from "./permissions";
import { notifyRoles, notifyUsers } from "./notify";
import { formatINR, humanize, num } from "./utils";

/**
 * Time limits (TAT) from the DSC SOPs. Each rule finds records that are waiting for someone to act and measures
 * how long they have waited against the limit. Limits are company settings (CompanySettings.tatConfig, hours).
 * Escalation: owner → their manager → directors, each notified once per item (dedupeKey).
 */

export type Item = {
  ruleKey: string;
  id: string;
  title: string;
  detail?: string;
  link: string;
  startedAt: Date;
  ownerIds: string[];
  ownerRoles: RoleKey[];
  projectId: string | null;
  managerIds: string[];
};

type Found = Omit<Item, "ruleKey" | "managerIds"> & { managerIds?: string[] };

export type Rule = {
  key: string;
  title: string;
  sop: string;
  defaultHours: number;
  perm: PermissionKey;
  managerRoles: RoleKey[];
  find: (companyId: string, cutoff: Date) => Promise<Found[]>;
};

const ids = (...x: (string | null | undefined)[]) => x.filter((v): v is string => !!v);
const MAX = 300;

export const RULES: Rule[] = [
  {
    key: "approvals", title: "Approvals waiting for a decision", sop: "Requests must not sit waiting – approvers decide within 24 hours.", defaultHours: 24, perm: "approvals:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.approval.findMany({ where: { companyId, status: "PENDING", createdAt: { lt: cutoff } }, take: MAX })).map((a) => ({
      id: a.id, title: a.title, detail: `Waiting for ${humanize(a.requiredRole)}${a.amount ? ` · ${formatINR(a.amount)}` : ""}`, link: "/approvals", startedAt: a.createdAt, ownerIds: [], ownerRoles: [a.requiredRole], projectId: null,
    })),
  },
  {
    key: "pr_to_po", title: "Approved material request – no purchase order yet", sop: "Procurement: vendor finalised within 24 hours and PO released the same day.", defaultHours: 24, perm: "purchase_requests:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.purchaseRequest.findMany({ where: { companyId, status: "APPROVED", updatedAt: { lt: cutoff } }, take: MAX })).map((r) => ({
      id: r.id, title: `${r.number} – approved, PO not raised`, link: `/procurement/requests/${r.id}`, startedAt: r.updatedAt, ownerIds: [], ownerRoles: ["PROCUREMENT"], projectId: r.projectId,
    })),
  },
  {
    key: "po_release", title: "Approved purchase order – not sent to vendor", sop: "Procurement: PO released the same day it is approved; vendor confirms within 24 hours.", defaultHours: 24, perm: "purchase_orders:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.purchaseOrder.findMany({ where: { companyId, status: "APPROVED", updatedAt: { lt: cutoff } }, take: MAX })).map((p) => ({
      id: p.id, title: `${p.number} – approved, not sent to vendor`, link: `/procurement/orders/${p.id}`, startedAt: p.updatedAt, ownerIds: ids(p.createdById), ownerRoles: ["PROCUREMENT"], projectId: p.projectId,
    })),
  },
  {
    key: "lead_quotation", title: "Site visit done – quotation not sent", sop: "Estimation: quotation submitted within 24 hours.", defaultHours: 24, perm: "leads:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.lead.findMany({ where: { companyId, deletedAt: null, stage: { in: ["SITE_VISIT_COMPLETED", "PROPOSAL_IN_PROGRESS"] }, updatedAt: { lt: cutoff }, quotations: { none: {} } }, take: MAX })).map((l) => ({
      id: l.id, title: `${l.code} ${l.name} – no quotation yet`, link: `/crm/leads/${l.id}`, startedAt: l.updatedAt, ownerIds: ids(l.assignedToId), ownerRoles: ["SALES"], projectId: null,
    })),
  },
  {
    key: "invoice_followup", title: "Invoice sent – payment follow-up due", sop: "Accounts Receivable: first follow-up within 3 days of submitting the invoice, then weekly until paid.", defaultHours: 72, perm: "invoices:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.invoice.findMany({ where: { companyId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, issueDate: { lt: cutoff } }, include: { client: { select: { name: true } } }, take: MAX }))
      .filter((i) => num(i.total) - num(i.paid) > 0.5)
      .map((i) => ({ id: i.id, title: `${i.number} – ${i.client.name}`, detail: `${formatINR(num(i.total) - num(i.paid))} still to collect`, link: `/finance/invoices/${i.id}`, startedAt: i.issueDate, ownerIds: [], ownerRoles: ["ACCOUNTS"] as RoleKey[], projectId: i.projectId })),
  },
  {
    key: "bill_certify", title: "Vendor bill waiting for certification", sop: "Accounts Payable: bills verified within 2 days – no bill is processed without the project manager's certification and supporting documents.", defaultHours: 48, perm: "bill_certification:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => {
      const bills = await db.vendorBill.findMany({ where: { companyId, certRequired: true, certifiedAt: null, status: { not: "CANCELLED" }, createdAt: { lt: cutoff } }, include: { vendor: { select: { name: true } } }, take: MAX });
      const pms = await db.project.findMany({ where: { id: { in: bills.map((b) => b.projectId).filter((x): x is string => !!x) } }, select: { id: true, projectManagerId: true } });
      const pm = new Map(pms.map((p) => [p.id, p.projectManagerId]));
      return bills.map((b) => ({ id: b.id, title: `${b.vendor.name} · bill ${b.number} – ${formatINR(b.amount)}`, link: "/bills-to-certify", startedAt: b.createdAt, ownerIds: ids(b.projectId ? pm.get(b.projectId) : null), ownerRoles: ["MANAGEMENT"] as RoleKey[], projectId: b.projectId }));
    },
  },
  {
    key: "extra_work_waiting", title: "Extra work waiting for the client's approval", sop: "Additional work is executed only after written client approval – chase the client within 3 days.", defaultHours: 72, perm: "extra_work:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.additionalWork.findMany({ where: { companyId, status: "SENT", sentAt: { lt: cutoff } }, include: { project: { select: { projectManagerId: true, code: true } } }, take: MAX })).map((w) => ({
      id: w.id, title: `${w.number} · ${w.title} (${w.project.code})`, detail: `${formatINR(w.amount)} – client has not answered`, link: "/extra-work", startedAt: w.sentAt!, ownerIds: ids(w.project.projectManagerId, w.requestedById), ownerRoles: [] as RoleKey[], projectId: w.projectId,
    })),
  },
  {
    key: "closure_checklist", title: "Project closure checklist not finished", sop: "HR & Admin: closure report within 15 days of handover; escalate to the Commercial Director and Managing Director if documents are still pending.", defaultHours: 360, perm: "closure:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.projectClosure.findMany({ where: { companyId, status: "OPEN", startedAt: { lt: cutoff } }, include: { project: { select: { code: true, name: true, projectManagerId: true } }, items: { select: { done: true, auto: true } } }, take: MAX })).map((r) => ({
      id: r.id, title: `${r.project.code} ${r.project.name} – ${r.items.filter((i) => !i.auto).filter((i) => i.done).length} of ${r.items.filter((i) => !i.auto).length} manual items done`, link: `/closure/${r.projectId}`, startedAt: r.startedAt, ownerIds: [], ownerRoles: ["HR"] as RoleKey[], projectId: r.projectId,
    })),
  },
  {
    key: "expense_verify", title: "Expense claim waiting for verification", sop: "HR / Accounts: reimbursement claims verified within 24 hours.", defaultHours: 24, perm: "expenses:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.expense.findMany({ where: { companyId, approved: false, rejectedAt: null, createdAt: { lt: cutoff } }, take: MAX })).map((e) => ({
      id: e.id, title: `${e.description} – ${formatINR(e.amount)}`, link: "/finance/expenses", startedAt: e.createdAt, ownerIds: [], ownerRoles: ["ACCOUNTS", "HR"] as RoleKey[], projectId: e.projectId,
    })),
  },
  {
    key: "snag_closure", title: "Snags still open after handover", sop: "Project Manager: snag closure within 7 days of handover.", defaultHours: 168, perm: "projects:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.project.findMany({ where: { companyId, deletedAt: null, status: "SNAGGING", updatedAt: { lt: cutoff } }, take: MAX })).map((p) => ({
      id: p.id, title: `${p.code} ${p.name} – snagging`, link: `/projects/${p.id}`, startedAt: p.updatedAt, ownerIds: ids(p.projectManagerId), ownerRoles: ["PROJECT_MANAGER"] as RoleKey[], projectId: p.id,
    })),
  },
  {
    key: "ticket_response", title: "Client complaint not yet taken up", sop: "Every client complaint is acknowledged and resolved within the agreed time.", defaultHours: 24, perm: "support:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.supportTicket.findMany({ where: { companyId, status: { in: ["OPEN", "ASSIGNED"] }, createdAt: { lt: cutoff } }, take: MAX })).map((t) => ({
      id: t.id, title: `${t.number} – ${t.subject}`, link: `/support/${t.id}`, startedAt: t.createdAt, ownerIds: ids(t.assignedToId), ownerRoles: ["PROJECT_MANAGER"] as RoleKey[], projectId: t.projectId,
    })),
  },
  {
    key: "task_overdue", title: "Task past its due date", sop: "Work is finished by the agreed date, or the delay is escalated before it happens.", defaultHours: 24, perm: "tasks:view", managerRoles: ["MANAGEMENT"],
    find: async (companyId, cutoff) => (await db.projectTask.findMany({ where: { companyId, status: { not: "COMPLETED" }, dueDate: { lt: cutoff } }, take: MAX })).map((t) => ({
      id: t.id, title: `${t.code} ${t.name}`, link: `/projects/${t.projectId}`, startedAt: t.dueDate!, ownerIds: ids(t.assignedToId), ownerRoles: [] as RoleKey[], projectId: t.projectId,
    })),
  },
  {
    // Serious actions are chased earlier: a critical one is overdue the moment it is due, a high one 6 hours before the grace period ends.
    key: "action_overdue", title: "Action or blocker past its due date", sop: "Every action has one owner and one date. When the date is missed the owner, then the project manager, then the directors are told.", defaultHours: 12, perm: "actions:view", managerRoles: ["MANAGEMENT", "OWNER"] as RoleKey[],
    find: async (companyId, cutoff) => {
      const H = 3600000;
      const rows = await db.actionItem.findMany({
        where: {
          companyId, status: { in: ["OPEN", "IN_PROGRESS"] },
          OR: [
            { severity: { in: ["LOW", "MEDIUM"] }, dueDate: { lt: cutoff } },
            { severity: "HIGH", dueDate: { lt: new Date(cutoff.getTime() + 6 * H) } },
            { severity: "CRITICAL", dueDate: { lt: new Date(cutoff.getTime() + 12 * H) } },
          ],
        },
        take: MAX,
      });
      return rows.map((a) => ({
        id: a.id, title: `${a.number} ${a.title}`, link: a.link ?? "/actions", ownerIds: ids(a.ownerId), ownerRoles: [] as RoleKey[], projectId: a.projectId,
        startedAt: new Date(a.dueDate.getTime() - (a.severity === "CRITICAL" ? 12 : a.severity === "HIGH" ? 6 : 0) * H),
      }));
    },
  },
];

export type Limits = Record<string, number>;

/** SOP defaults overlaid with the company's own settings. */
export async function getLimits(companyId: string): Promise<Limits> {
  const s = await db.companySettings.findUnique({ where: { companyId }, select: { tatConfig: true } });
  const cfg = (s?.tatConfig && typeof s.tatConfig === "object" && !Array.isArray(s.tatConfig) ? s.tatConfig : {}) as Record<string, unknown>;
  return Object.fromEntries(RULES.map((r) => {
    const v = Number(cfg[r.key]);
    return [r.key, Number.isFinite(v) && v >= 1 && v <= 24 * 90 ? v : r.defaultHours];
  }));
}

export function hoursLabel(h: number) {
  const r = Math.round(h);
  if (r < 48) return `${r} hour${r === 1 ? "" : "s"}`;
  const d = Math.floor(r / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export type State = "due_soon" | "overdue";
export type Tracked = Item & { rule: Rule; limitHours: number; state: State; overdueHours: number; elapsedHours: number };

/** Everything currently late or about to be late (75% of the limit used). */
export async function getTimeLimitItems(companyId: string, now: Date = new Date()): Promise<Tracked[]> {
  const limits = await getLimits(companyId);
  const batches = await Promise.all(RULES.map(async (rule) => {
    const L = limits[rule.key];
    const cutoff = new Date(now.getTime() - L * 0.75 * 3600000);
    const found = await rule.find(companyId, cutoff);
    return found.map<Tracked | null>((f) => {
      const elapsed = (now.getTime() - f.startedAt.getTime()) / 3600000;
      if (elapsed < L * 0.75) return null;
      return { ...f, ruleKey: rule.key, managerIds: [], rule, limitHours: L, elapsedHours: elapsed, state: elapsed > L ? "overdue" : "due_soon", overdueHours: Math.max(0, elapsed - L) };
    }).filter((x): x is Tracked => !!x);
  }));
  const all = batches.flat();
  // managers come from the project the item belongs to
  const pids = [...new Set(all.map((i) => i.projectId).filter((x): x is string => !!x))];
  const projects = pids.length ? await db.project.findMany({ where: { id: { in: pids } }, select: { id: true, projectManagerId: true } }) : [];
  const pm = new Map(projects.map((p) => [p.id, p.projectManagerId]));
  for (const i of all) i.managerIds = ids(i.projectId ? pm.get(i.projectId) : null).filter((m) => !i.ownerIds.includes(m));
  return all.sort((a, b) => (a.state === b.state ? b.overdueHours - a.overdueHours : a.state === "overdue" ? -1 : 1));
}

export const MANAGER_AFTER = (limit: number) => Math.max(12, limit * 0.5); // hours past the limit before the manager is told
export const DIRECTOR_AFTER = (limit: number) => Math.max(48, limit); // …and before the directors are told

/**
 * Tells people about items that have run past their limit. Safe to run any number of times: each person is told
 * once per item per level. Returns the number of overdue items checked.
 */
export async function runTimeLimitReminders(companyId: string, now: Date = new Date()): Promise<{ overdue: number }> {
  const items = (await getTimeLimitItems(companyId, now)).filter((i) => i.state === "overdue");
  for (const i of items) {
    const late = hoursLabel(Math.max(1, i.overdueHours));
    const base = { companyId, type: "TIME_LIMIT" as const, link: i.link };
    const key = (n: number) => `tat:${i.ruleKey}:${i.id}:L${n}`;
    const body = `${i.rule.title}. Limit was ${hoursLabel(i.limitHours)}; now ${late} late.`;
    if (i.ownerIds.length) await notifyUsers(i.ownerIds, { ...base, title: `Overdue: ${i.title}`, body, dedupeKey: key(1) });
    else if (i.ownerRoles.length) await notifyRoles(companyId, i.ownerRoles, { ...base, title: `Overdue: ${i.title}`, body, dedupeKey: key(1) });
    if (i.overdueHours >= MANAGER_AFTER(i.limitHours)) {
      const t = { ...base, title: `Still overdue: ${i.title}`, body, dedupeKey: key(2) };
      if (i.managerIds.length) await notifyUsers(i.managerIds, t);
      else await notifyRoles(companyId, i.rule.managerRoles, t);
    }
    if (i.overdueHours >= DIRECTOR_AFTER(i.limitHours)) {
      await notifyRoles(companyId, ["OWNER", "MANAGEMENT"], { ...base, title: `Needs your attention: ${i.title}`, body: `${body} The owner and manager have already been told.`, dedupeKey: key(3) });
    }
  }
  return { overdue: items.length };
}
