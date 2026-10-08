import "server-only";
import { db } from "./db";
import type { Ctx } from "./auth";
import type { PermissionKey } from "./permissions";
import { leadScope, projectScope } from "./scope";
import { projectFinancials } from "./project-finance";
import { receivables, payables } from "./finance-stats";
import { num, round2, humanize } from "./utils";

export type ColType = "text" | "money" | "number" | "date" | "pct";
export type Column = { key: string; label: string; type?: ColType };
export type Row = Record<string, string | number | Date | null>;
export type ReportResult = { columns: Column[]; rows: Row[]; totals?: Row; note?: string };
export type Filters = { from: Date; to: Date; projectId?: string; clientId?: string; vendorId?: string };
export type Report = { key: string; title: string; group: string; description: string; perm: PermissionKey; extra?: PermissionKey; filters: ("period" | "project" | "client" | "vendor")[]; run: (c: Ctx, f: Filters) => Promise<ReportResult> };

const sum = (rows: Row[], k: string) => round2(rows.reduce((s, r) => s + num(r[k] as number), 0));
const D = (d: Date | null | undefined) => d ?? null;

async function visibleProjects(c: Ctx, f: Filters) {
  return (await db.project.findMany({ where: { ...projectScope(c), ...(f.projectId ? { id: f.projectId } : {}), ...(f.clientId ? { clientId: f.clientId } : {}) }, select: { id: true } })).map((p) => p.id);
}

export const REPORTS: Report[] = [
  {
    key: "sales", title: "Sales report", group: "Sales", description: "Quotations raised, approved and won in the period.", perm: "quotations:view", filters: ["period", "client"],
    run: async (c, f) => {
      const q = await db.quotation.findMany({ where: { companyId: c.companyId, deletedAt: null, date: { gte: f.from, lt: f.to }, ...(f.clientId ? { clientId: f.clientId } : {}), ...(c.role === "SALES" ? { preparedById: c.userId } : {}) }, include: { client: { select: { name: true } } }, orderBy: { date: "desc" } });
      const rows = q.map((x) => ({ number: x.number, date: x.date, client: x.client.name, title: x.title, status: humanize(x.status), total: num(x.total) }));
      return { columns: [{ key: "number", label: "Quotation" }, { key: "date", label: "Date", type: "date" }, { key: "client", label: "Client" }, { key: "title", label: "Scope" }, { key: "status", label: "Status" }, { key: "total", label: "Total (incl. GST)", type: "money" }], rows, totals: { number: "Total", total: sum(rows, "total") } };
    },
  },
  {
    key: "leads", title: "Lead report", group: "Sales", description: "Leads created in the period with source, stage and value.", perm: "leads:view", filters: ["period"],
    run: async (c, f) => {
      const l = await db.lead.findMany({ where: { ...leadScope(c), createdAt: { gte: f.from, lt: f.to } }, orderBy: { createdAt: "desc" } });
      const users = await db.user.findMany({ where: { id: { in: l.map((x) => x.assignedToId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
      const nm = new Map(users.map((u) => [u.id, u.name]));
      const rows = l.map((x) => ({ code: x.code, created: x.createdAt, name: x.name, source: x.source, segment: humanize(x.segment), stage: humanize(x.stage), owner: x.assignedToId ? nm.get(x.assignedToId) ?? "" : "Unassigned", value: num(x.estimatedValue) }));
      return { columns: [{ key: "code", label: "Lead" }, { key: "created", label: "Created", type: "date" }, { key: "name", label: "Name" }, { key: "source", label: "Source" }, { key: "segment", label: "Segment" }, { key: "stage", label: "Stage" }, { key: "owner", label: "Owner" }, { key: "value", label: "Est. value", type: "money" }], rows, totals: { code: "Total", value: sum(rows, "value") } };
    },
  },
  {
    key: "boq", title: "BOQ report", group: "Projects", description: "Selling value, estimated cost and margin of every current BOQ.", perm: "boq:view", extra: "margins:view", filters: ["project"],
    run: async (c, f) => {
      const ids = await visibleProjects(c, f);
      const b = await db.boq.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { not: "REVISED" }, OR: [{ projectId: { in: ids } }, ...(f.projectId ? [] : [{ projectId: null }])] }, include: { project: { select: { code: true, name: true } }, items: { select: { estimatedCost: true, total: true } } }, orderBy: { number: "asc" } });
      const rows = b.map((x) => { const cost = x.items.reduce((s, i) => s + num(i.estimatedCost), 0); const rev = x.items.reduce((s, i) => s + num(i.total), 0); return { number: x.number, project: x.project ? `${x.project.code} ${x.project.name}` : "—", status: humanize(x.status), items: x.items.length, cost: round2(cost), revenue: round2(rev), margin: rev ? round2(((rev - cost) / rev) * 100) : 0 }; });
      return { columns: [{ key: "number", label: "BOQ" }, { key: "project", label: "Project" }, { key: "status", label: "Status" }, { key: "items", label: "Items", type: "number" }, { key: "cost", label: "Estimated cost", type: "money" }, { key: "revenue", label: "Selling value", type: "money" }, { key: "margin", label: "Margin", type: "pct" }], rows, totals: { number: "Total", cost: sum(rows, "cost"), revenue: sum(rows, "revenue") } };
    },
  },
  {
    key: "projects", title: "Project report", group: "Projects", description: "Status, progress and dates of every project.", perm: "projects:view", filters: ["client"],
    run: async (c, f) => {
      const p = await db.project.findMany({ where: { ...projectScope(c), ...(f.clientId ? { clientId: f.clientId } : {}) }, include: { client: { select: { name: true } } }, orderBy: { code: "asc" } });
      const money = c.can("margins:view");
      const rows = p.map((x) => ({ code: x.code, name: x.name, client: x.client.name, status: humanize(x.status), progress: x.progress, start: D(x.startDate), due: D(x.plannedEndDate), value: money ? num(x.contractValue) : null }));
      return { columns: [{ key: "code", label: "Project" }, { key: "name", label: "Name" }, { key: "client", label: "Client" }, { key: "status", label: "Status" }, { key: "progress", label: "Progress", type: "pct" }, { key: "start", label: "Start", type: "date" }, { key: "due", label: "Due", type: "date" }, ...(money ? [{ key: "value", label: "Contract value", type: "money" as const }] : [])], rows, totals: money ? { code: "Total", value: sum(rows, "value") } : undefined };
    },
  },
  {
    key: "profitability", title: "Profitability report", group: "Finance", description: "Contract value minus material, labour, vendor and other cost – per project.", perm: "projects:view", extra: "margins:view", filters: ["client"],
    run: async (c, f) => {
      const p = await db.project.findMany({ where: { ...projectScope(c), ...(f.clientId ? { clientId: f.clientId } : {}) }, orderBy: { code: "asc" } });
      const fin = await projectFinancials(c.companyId, p.map((x) => x.id));
      const rows = p.map((x) => { const v = fin.get(x.id)!; return { code: x.code, name: x.name, revenue: v.contractValue, material: v.material, labour: v.labour, vendor: v.vendor, other: v.other, cost: v.actualCost, profit: v.profit, margin: v.marginPct }; });
      return { columns: [{ key: "code", label: "Project" }, { key: "name", label: "Name" }, { key: "revenue", label: "Contract value", type: "money" }, { key: "material", label: "Material", type: "money" }, { key: "labour", label: "Labour", type: "money" }, { key: "vendor", label: "Vendors", type: "money" }, { key: "other", label: "Other", type: "money" }, { key: "cost", label: "Actual cost", type: "money" }, { key: "profit", label: "Profit", type: "money" }, { key: "margin", label: "Margin", type: "pct" }], rows, totals: { code: "Total", revenue: sum(rows, "revenue"), material: sum(rows, "material"), labour: sum(rows, "labour"), vendor: sum(rows, "vendor"), other: sum(rows, "other"), cost: sum(rows, "cost"), profit: sum(rows, "profit") } };
    },
  },
  {
    key: "budget", title: "Project budget variance", group: "Finance", description: "Estimated cost (budget) against actual cost; positive variance = over budget.", perm: "projects:view", extra: "margins:view", filters: ["client"],
    run: async (c, f) => {
      const p = await db.project.findMany({ where: { ...projectScope(c), ...(f.clientId ? { clientId: f.clientId } : {}) }, orderBy: { code: "asc" } });
      const fin = await projectFinancials(c.companyId, p.map((x) => x.id));
      const rows = p.map((x) => { const v = fin.get(x.id)!; return { code: x.code, name: x.name, budget: v.budget, actual: v.actualCost, variance: v.variance, pct: v.variancePct, estProfit: v.estimatedProfit, profit: v.profit }; });
      return { columns: [{ key: "code", label: "Project" }, { key: "name", label: "Name" }, { key: "budget", label: "Budget", type: "money" }, { key: "actual", label: "Actual cost", type: "money" }, { key: "variance", label: "Variance", type: "money" }, { key: "pct", label: "Variance %", type: "pct" }, { key: "estProfit", label: "Estimated profit", type: "money" }, { key: "profit", label: "Profit so far", type: "money" }], rows, totals: { code: "Total", budget: sum(rows, "budget"), actual: sum(rows, "actual"), variance: sum(rows, "variance") } };
    },
  },
  {
    key: "purchases", title: "Purchase report", group: "Procurement", description: "Purchase orders in the period by vendor and project.", perm: "purchase_orders:view", filters: ["period", "project", "vendor"],
    run: async (c, f) => {
      const ids = f.projectId ? [f.projectId] : null;
      const po = await db.purchaseOrder.findMany({ where: { companyId: c.companyId, status: { notIn: ["DRAFT", "CANCELLED"] }, orderDate: { gte: f.from, lt: f.to }, ...(f.vendorId ? { vendorId: f.vendorId } : {}), ...(ids ? { projectId: { in: ids } } : {}) }, include: { vendor: { select: { name: true } }, project: { select: { code: true } } }, orderBy: { orderDate: "desc" } });
      const rows = po.map((x) => ({ number: x.number, date: x.orderDate, vendor: x.vendor.name, project: x.project?.code ?? "Stock", status: humanize(x.status), delivery: D(x.deliveryDate), total: num(x.total) }));
      return { columns: [{ key: "number", label: "PO" }, { key: "date", label: "Date", type: "date" }, { key: "vendor", label: "Vendor" }, { key: "project", label: "Project" }, { key: "status", label: "Status" }, { key: "delivery", label: "Delivery due", type: "date" }, { key: "total", label: "Total", type: "money" }], rows, totals: { number: "Total", total: sum(rows, "total") } };
    },
  },
  {
    key: "vendors", title: "Vendor report", group: "Procurement", description: "Orders, on-time delivery and amounts owed per vendor.", perm: "vendors:view", extra: "vendor_bills:view", filters: [],
    run: async (c) => {
      const v = await db.vendor.findMany({ where: { companyId: c.companyId, deletedAt: null }, include: { purchaseOrders: { where: { status: { notIn: ["DRAFT", "CANCELLED"] } }, include: { receipts: { select: { deliveryDate: true } } } }, bills: { where: { status: { not: "CANCELLED" } } } }, orderBy: { name: "asc" } });
      const rows = v.map((x) => { const done = x.purchaseOrders.filter((p) => ["RECEIVED", "CLOSED"].includes(p.status) && p.deliveryDate && p.receipts.length); const ontime = done.filter((p) => Math.max(...p.receipts.map((r) => r.deliveryDate.getTime())) <= p.deliveryDate!.getTime() + 86399999).length; return { name: x.name, orders: x.purchaseOrders.length, purchased: round2(x.purchaseOrders.reduce((s, p) => s + num(p.total), 0)), ontime: done.length ? round2((ontime / done.length) * 100) : null, pending: round2(x.bills.reduce((s, b) => s + num(b.amount) - num(b.paid), 0)), rating: x.rating }; });
      return { columns: [{ key: "name", label: "Vendor" }, { key: "orders", label: "Orders", type: "number" }, { key: "purchased", label: "Total purchased", type: "money" }, { key: "ontime", label: "On-time delivery", type: "pct" }, { key: "pending", label: "Payable now", type: "money" }, { key: "rating", label: "Rating", type: "number" }], rows, totals: { name: "Total", purchased: sum(rows, "purchased"), pending: sum(rows, "pending") } };
    },
  },
  {
    key: "inventory", title: "Inventory report", group: "Inventory", description: "Stock on hand and its value, by material.", perm: "inventory:view", filters: [],
    run: async (c) => {
      const m = await db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, include: { stock: true }, orderBy: { name: "asc" } });
      const rows = m.map((x) => { const q = x.stock.reduce((s, b) => s + num(b.quantity), 0); return { sku: x.sku, name: x.name, category: humanize(x.category), unit: x.unit, qty: q, reorder: num(x.reorderLevel), status: num(x.reorderLevel) > 0 && q <= num(x.reorderLevel) ? "LOW" : "OK", value: round2(x.stock.reduce((s, b) => s + num(b.quantity) * num(b.avgCost), 0)) }; });
      return { columns: [{ key: "sku", label: "SKU" }, { key: "name", label: "Material" }, { key: "category", label: "Category" }, { key: "unit", label: "Unit" }, { key: "qty", label: "In stock", type: "number" }, { key: "reorder", label: "Reorder level", type: "number" }, { key: "status", label: "Status" }, { key: "value", label: "Value", type: "money" }], rows, totals: { sku: "Total", value: sum(rows, "value") } };
    },
  },
  {
    key: "consumption", title: "Material consumption", group: "Inventory", description: "Material issued to and consumed on sites in the period.", perm: "inventory:view", filters: ["period", "project"],
    run: async (c, f) => {
      const ids = await visibleProjects(c, f);
      const t = await db.$queryRaw<{ project: string; material: string; unit: string; issued: number; returned: number; consumed: number; value: number }[]>`
        SELECT p.code AS project, m.name AS material, m.unit,
               COALESCE(SUM(i.quantity) FILTER (WHERE i.type = 'OUTWARD'), 0)::float AS issued,
               COALESCE(SUM(i.quantity) FILTER (WHERE i.type = 'RETURN'), 0)::float AS returned,
               COALESCE(SUM(i.quantity) FILTER (WHERE i.type = 'CONSUMED'), 0)::float AS consumed,
               COALESCE(SUM(i.quantity * i."unitCost") FILTER (WHERE i.type = 'OUTWARD'), 0)::float AS value
        FROM "InventoryTransaction" i JOIN "Material" m ON m.id = i."materialId" JOIN "Project" p ON p.id = i."projectId"
        WHERE i."companyId" = ${c.companyId} AND i.type IN ('OUTWARD','CONSUMED','RETURN') AND i."projectId" = ANY(${ids}) AND i."createdAt" >= ${f.from} AND i."createdAt" < ${f.to}
        GROUP BY p.code, m.name, m.unit ORDER BY p.code, m.name`;
      const rows: Row[] = t.map((r) => ({ project: r.project, material: r.material, unit: r.unit, issued: round2(r.issued), returned: round2(r.returned), consumed: round2(r.consumed), value: round2(r.value) }));
      return { columns: [{ key: "project", label: "Project" }, { key: "material", label: "Material" }, { key: "unit", label: "Unit" }, { key: "issued", label: "Issued", type: "number" }, { key: "returned", label: "Returned", type: "number" }, { key: "consumed", label: "Consumed", type: "number" }, { key: "value", label: "Issued value", type: "money" }], rows, totals: { project: "Total", value: sum(rows, "value") } };
    },
  },
  {
    key: "attendance", title: "Worker attendance", group: "Workforce", description: "Days present, absent and overtime per worker.", perm: "attendance:view", filters: ["period", "project"],
    run: async (c, f) => {
      const ids = await visibleProjects(c, f);
      const t = await db.$queryRaw<{ code: string; name: string; trade: string; present: bigint; half: bigint; absent: bigint; leave: bigint; ot: number }[]>`
        SELECT w.code, w.name, w.trade::text AS trade,
               COUNT(*) FILTER (WHERE a.status IN ('PRESENT','OVERTIME')) AS present, COUNT(*) FILTER (WHERE a.status = 'HALF_DAY') AS half,
               COUNT(*) FILTER (WHERE a.status = 'ABSENT') AS absent, COUNT(*) FILTER (WHERE a.status = 'LEAVE') AS leave,
               COALESCE(SUM(a."overtimeHrs"), 0)::float AS ot
        FROM "Attendance" a JOIN "Worker" w ON w.id = a."workerId"
        WHERE a."companyId" = ${c.companyId} AND a."projectId" = ANY(${ids}) AND a.date >= ${f.from} AND a.date < ${f.to}
        GROUP BY w.id ORDER BY w.name`;
      const rows: Row[] = t.map((r) => ({ code: r.code, name: r.name, trade: humanize(r.trade), present: Number(r.present), half: Number(r.half), absent: Number(r.absent), leave: Number(r.leave), ot: r.ot }));
      return { columns: [{ key: "code", label: "ID" }, { key: "name", label: "Worker" }, { key: "trade", label: "Trade" }, { key: "present", label: "Present", type: "number" }, { key: "half", label: "Half days", type: "number" }, { key: "absent", label: "Absent", type: "number" }, { key: "leave", label: "Leave", type: "number" }, { key: "ot", label: "OT hours", type: "number" }], rows };
    },
  },
  {
    key: "labour", title: "Labour cost report", group: "Workforce", description: "Wages by project and trade from attendance.", perm: "attendance:view", extra: "margins:view", filters: ["period", "project"],
    run: async (c, f) => {
      const ids = await visibleProjects(c, f);
      const t = await db.$queryRaw<{ project: string; trade: string; days: number; cost: number }[]>`
        SELECT p.code AS project, w.trade::text AS trade,
               (COUNT(*) FILTER (WHERE a.status IN ('PRESENT','OVERTIME')) + 0.5 * COUNT(*) FILTER (WHERE a.status = 'HALF_DAY'))::float AS days,
               COALESCE(SUM(a."wageCost"), 0)::float AS cost
        FROM "Attendance" a JOIN "Worker" w ON w.id = a."workerId" JOIN "Project" p ON p.id = a."projectId"
        WHERE a."companyId" = ${c.companyId} AND a."projectId" = ANY(${ids}) AND a.date >= ${f.from} AND a.date < ${f.to}
        GROUP BY p.code, w.trade ORDER BY p.code, w.trade`;
      const rows: Row[] = t.map((r) => ({ project: r.project, trade: humanize(r.trade), days: r.days, cost: round2(r.cost) }));
      return { columns: [{ key: "project", label: "Project" }, { key: "trade", label: "Trade" }, { key: "days", label: "Worker-days", type: "number" }, { key: "cost", label: "Wages", type: "money" }], rows, totals: { project: "Total", cost: sum(rows, "cost") } };
    },
  },
  {
    key: "expenses", title: "Expense report", group: "Finance", description: "Approved expenses in the period.", perm: "expenses:view", extra: "finance:view", filters: ["period", "project"],
    run: async (c, f) => {
      const e = await db.expense.findMany({ where: { companyId: c.companyId, approved: true, date: { gte: f.from, lt: f.to }, ...(f.projectId ? { projectId: f.projectId } : {}) }, include: { project: { select: { code: true } } }, orderBy: { date: "desc" } });
      const rows = e.map((x) => ({ date: x.date, category: humanize(x.category), description: x.description, project: x.project?.code ?? "—", paidBy: x.paidBy, amount: num(x.amount) }));
      return { columns: [{ key: "date", label: "Date", type: "date" }, { key: "category", label: "Category" }, { key: "description", label: "Description" }, { key: "project", label: "Project" }, { key: "paidBy", label: "Paid by" }, { key: "amount", label: "Amount", type: "money" }], rows, totals: { date: "Total", amount: sum(rows, "amount") } };
    },
  },
  {
    key: "invoices", title: "Invoice report", group: "Finance", description: "Invoices raised in the period, with paid and balance.", perm: "invoices:view", filters: ["period", "client", "project"],
    run: async (c, f) => {
      const i = await db.invoice.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { not: "CANCELLED" }, issueDate: { gte: f.from, lt: f.to }, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.projectId ? { projectId: f.projectId } : {}) }, include: { client: { select: { name: true } }, project: { select: { code: true } } }, orderBy: { issueDate: "desc" } });
      const rows = i.map((x) => ({ number: x.number, date: x.issueDate, client: x.client.name, project: x.project?.code ?? "—", due: D(x.dueDate), status: humanize(x.status), total: num(x.total), paid: num(x.paid), balance: round2(num(x.total) - num(x.paid)) }));
      return { columns: [{ key: "number", label: "Invoice" }, { key: "date", label: "Date", type: "date" }, { key: "client", label: "Client" }, { key: "project", label: "Project" }, { key: "due", label: "Due", type: "date" }, { key: "status", label: "Status" }, { key: "total", label: "Total", type: "money" }, { key: "paid", label: "Paid", type: "money" }, { key: "balance", label: "Balance", type: "money" }], rows, totals: { number: "Total", total: sum(rows, "total"), paid: sum(rows, "paid"), balance: sum(rows, "balance") } };
    },
  },
  {
    key: "payments", title: "Payment report", group: "Finance", description: "Client payments received in the period.", perm: "payments:view", filters: ["period", "client"],
    run: async (c, f) => {
      const p = await db.payment.findMany({ where: { companyId: c.companyId, date: { gte: f.from, lt: f.to }, ...(f.clientId ? { invoice: { clientId: f.clientId } } : {}) }, include: { invoice: { select: { number: true, client: { select: { name: true } } } } }, orderBy: { date: "desc" } });
      const rows = p.map((x) => ({ date: x.date, client: x.invoice.client.name, invoice: x.invoice.number, method: humanize(x.method), reference: x.reference, amount: num(x.amount) }));
      return { columns: [{ key: "date", label: "Date", type: "date" }, { key: "client", label: "Client" }, { key: "invoice", label: "Invoice" }, { key: "method", label: "Method" }, { key: "reference", label: "Reference" }, { key: "amount", label: "Amount", type: "money" }], rows, totals: { date: "Total", amount: sum(rows, "amount") } };
    },
  },
  {
    key: "receivables", title: "Receivables report", group: "Finance", description: "Unpaid client invoices, oldest first.", perm: "invoices:view", filters: [],
    run: async (c) => {
      const r = await receivables(c.companyId);
      const today = new Date();
      const rows = r.open.map((i) => ({ number: i.number, client: i.client.name, due: D(i.dueDate), daysLate: Math.max(0, Math.floor((today.getTime() - (i.dueDate ?? i.issueDate).getTime()) / 86400000)), balance: i.balance })).sort((a, b) => num(b.daysLate) - num(a.daysLate));
      return { columns: [{ key: "number", label: "Invoice" }, { key: "client", label: "Client" }, { key: "due", label: "Due", type: "date" }, { key: "daysLate", label: "Days late", type: "number" }, { key: "balance", label: "Balance", type: "money" }], rows, totals: { number: "Total", balance: sum(rows, "balance") } };
    },
  },
  {
    key: "payables", title: "Payables report", group: "Finance", description: "Unpaid vendor bills, oldest first.", perm: "vendor_bills:view", filters: [],
    run: async (c) => {
      const r = await payables(c.companyId);
      const today = new Date();
      const rows = r.open.map((b) => ({ number: b.number, vendor: b.vendor.name, due: D(b.dueDate), daysLate: Math.max(0, Math.floor((today.getTime() - (b.dueDate ?? b.billDate).getTime()) / 86400000)), balance: b.balance })).sort((a, b) => num(b.daysLate) - num(a.daysLate));
      return { columns: [{ key: "number", label: "Bill" }, { key: "vendor", label: "Vendor" }, { key: "due", label: "Due", type: "date" }, { key: "daysLate", label: "Days late", type: "number" }, { key: "balance", label: "Balance", type: "money" }], rows, totals: { number: "Total", balance: sum(rows, "balance") } };
    },
  },
];

export const reportByKey = (k: string) => REPORTS.find((r) => r.key === k);
export const canRun = (c: Ctx, r: Report) => c.can("reports:view") && c.can(r.perm) && (!r.extra || c.can(r.extra));
