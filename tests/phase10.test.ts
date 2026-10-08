import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs, logout, fd } from "./setup";
import { approveMilestone, respondToQuotation, createClientTicket } from "@/app/(portal)/portal/actions";
import { acknowledgeOrder } from "@/app/(portal)/vendor-portal/actions";
import { workerTaskStatus, workerRequestMaterial, workerReportIssue } from "@/app/(worker)/worker/actions";
import { GET as invoicePdf } from "@/app/(app)/finance/invoices/[id]/pdf/route";
import { GET as quotePdf } from "@/app/(app)/sales/quotations/[id]/pdf/route";
import { GET as poPdf } from "@/app/(app)/procurement/orders/[id]/pdf/route";
import { GET as boqPdf } from "@/app/(app)/sales/boq/[id]/pdf/route";
import { GET as reportExport } from "@/app/(app)/reports/[key]/export/route";
import { REPORTS, canRun } from "@/lib/reports";
import { parseFilters } from "@/lib/report-filters";
import { globalSearch } from "@/lib/search";
import { executiveStats, resolvePeriod } from "@/lib/dashboard";
import { receivables } from "@/lib/finance-stats";
import { updateTicket } from "@/app/(app)/support/actions";

beforeEach(() => logout());
const req = (url = "http://localhost/x") => new NextRequest(url);
const call = (h: Function, id: string) => h(req(), { params: Promise.resolve({ id }) }) as Promise<Response>; // eslint-disable-line @typescript-eslint/no-unsafe-function-type
const ctxAs = async (email: string) => { await loginAs(email); return (await getCtx())!; };

describe("client portal isolation", () => {
  it("a client can only download their own, issued invoices and sent quotations", async () => {
    const anil = await db.client.findFirstOrThrow({ where: { name: "Anil Deshpande" } });
    const mine = await db.invoice.findFirstOrThrow({ where: { clientId: anil.id, status: { in: ["PAID", "PARTIALLY_PAID"] } } });
    const others = await db.invoice.findFirstOrThrow({ where: { clientId: { not: anil.id }, status: { in: ["SENT", "OVERDUE", "PARTIALLY_PAID", "PAID"] } } });
    const draft = await db.invoice.findFirstOrThrow({ where: { status: "DRAFT" } });
    await loginAs("client@dsc.demo");
    expect((await call(invoicePdf, mine.id)).status).toBe(200);
    expect((await call(invoicePdf, others.id)).status).toBe(404);
    expect((await call(invoicePdf, draft.id)).status).toBe(404);
    const sent = await db.quotation.findFirstOrThrow({ where: { clientId: { not: anil.id }, status: "SENT" } });
    expect((await call(quotePdf, sent.id)).status).toBe(404);
    const po = await db.purchaseOrder.findFirstOrThrow({});
    expect((await call(poPdf, po.id)).status).toBe(403);
    const boq = await db.boq.findFirstOrThrow({});
    expect((await call(boqPdf, boq.id)).status).toBe(403);
  });

  it("a client can't approve another client's milestone", async () => {
    const other = await db.project.findFirstOrThrow({ where: { code: "PRJ-00002" } });
    const done = await db.projectMilestone.create({ data: { companyId: other.companyId, projectId: other.id, name: "Other client's stage", completedAt: new Date(), billingPct: 0 } });
    await loginAs("client@dsc.demo");
    expect((await approveMilestone(done.id)).ok).toBe(false);
    expect((await db.projectMilestone.findUniqueOrThrow({ where: { id: done.id } })).clientApproved).toBe(false);
  });

  it("approving own completed stage works once and notifies the project manager and accounts", async () => {
    const p = await db.project.findFirstOrThrow({ where: { code: "PRJ-00001" } });
    const m = await db.projectMilestone.create({ data: { companyId: p.companyId, projectId: p.id, name: "Portal approval stage", completedAt: new Date(), billingPct: 0 } });
    const open = await db.projectMilestone.create({ data: { companyId: p.companyId, projectId: p.id, name: "Not finished yet", billingPct: 0 } });
    await loginAs("client@dsc.demo");
    expect((await approveMilestone(open.id)).ok).toBe(false); // not completed
    expect((await approveMilestone(m.id)).ok).toBe(true);
    expect((await approveMilestone(m.id)).ok).toBe(false); // only once
    expect((await db.projectMilestone.findUniqueOrThrow({ where: { id: m.id } })).clientApproved).toBe(true);
    const pm = await db.user.findUniqueOrThrow({ where: { id: p.projectManagerId! } });
    expect(await db.notification.count({ where: { userId: pm.id, title: { contains: "Portal approval stage" } } })).toBe(1);
  });

  it("responding to a quotation: only your own open ones; accept → Won; changes need a note", async () => {
    const bhatia = await db.client.findFirstOrThrow({ where: { name: "Rahul Bhatia" } });
    const q = await db.quotation.findFirstOrThrow({ where: { clientId: bhatia.id, status: "SENT" } });
    await loginAs("client@dsc.demo"); // Anil – not the owner of this quotation
    expect((await respondToQuotation(q.id, "ACCEPT")).ok).toBe(false);
    await loginAs("bhatia@dsc.demo");
    expect((await respondToQuotation(q.id, "CHANGES", fd({ note: "" }))).ok).toBe(false);
    expect((await respondToQuotation(q.id, "CHANGES", fd({ note: "Please use a lighter wood finish" }))).ok).toBe(true);
    expect((await db.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("NEGOTIATION");
    expect((await respondToQuotation(q.id, "ACCEPT")).ok).toBe(true);
    expect((await db.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("ACCEPTED");
    expect((await respondToQuotation(q.id, "ACCEPT")).ok).toBe(false); // already decided
  });

  it("a client opens a support ticket on their own project only, with warranty worked out", async () => {
    const mine = await db.project.findFirstOrThrow({ where: { code: "PRJ-00001" } });
    const notMine = await db.project.findFirstOrThrow({ where: { code: "PRJ-00002" } });
    await loginAs("client@dsc.demo");
    expect((await createClientTicket(fd({ projectId: notMine.id, subject: "Not mine" }))).ok).toBe(false);
    expect((await createClientTicket(fd({ projectId: mine.id, subject: "Portal-raised issue" }))).ok).toBe(true);
    const t = await db.supportTicket.findFirstOrThrow({ where: { subject: "Portal-raised issue" } });
    expect(t.clientId).toBe(mine.clientId);
    expect(t.assignedToId).toBe(mine.projectManagerId);
  });

  it("clients can't use staff actions: editing someone's ticket is refused", async () => {
    const t = await db.supportTicket.findFirstOrThrow({});
    await loginAs("client@dsc.demo");
    expect((await updateTicket(t.id, fd({ subject: "Hacked" }))).ok).toBe(false);
  });
});

describe("vendor portal isolation", () => {
  it("a vendor sees only their own purchase orders", async () => {
    const mine = await db.purchaseOrder.findFirstOrThrow({ where: { vendor: { name: { startsWith: "Greenply" } }, status: { in: ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED", "RECEIVED"] } } });
    const other = await db.purchaseOrder.findFirstOrThrow({ where: { vendor: { name: { not: { startsWith: "Greenply" } } }, status: { in: ["SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] } } });
    await loginAs("vendor@dsc.demo");
    expect((await call(poPdf, mine.id)).status).toBe(200);
    expect((await call(poPdf, other.id)).status).toBe(404);
    expect((await acknowledgeOrder(other.id, fd({ note: "hello" }))).ok).toBe(false);
    const inv = await db.invoice.findFirstOrThrow({});
    expect((await call(invoicePdf, inv.id)).status).toBe(403);
  });

  it("a vendor's delivery update changes the date, is audited and tells procurement", async () => {
    const po = await db.purchaseOrder.findFirstOrThrow({ where: { vendor: { name: { startsWith: "Greenply" } }, status: { in: ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] } } });
    await loginAs("vendor@dsc.demo");
    expect((await acknowledgeOrder(po.id, fd({ expectedDate: "2031-02-02", note: "Dispatch Friday" }))).ok).toBe(true);
    const after = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(after.deliveryDate?.toISOString().slice(0, 10)).toBe("2031-02-02");
    expect(after.notes).toContain("Dispatch Friday");
    expect(await db.auditLog.count({ where: { entityId: po.id, summary: { contains: "Vendor" } } })).toBeGreaterThan(0);
  });
});

describe("worker app", () => {
  it("a worker can only change their own tasks", async () => {
    const mine = await db.projectTask.findFirstOrThrow({ where: { workerId: { not: null } } });
    const others = await db.projectTask.findFirstOrThrow({ where: { workerId: null, status: "TODO" } });
    await loginAs("w-00001@workers.local");
    expect((await workerTaskStatus(others.id, "COMPLETED")).ok).toBe(false);
    expect((await db.projectTask.findUniqueOrThrow({ where: { id: others.id } })).status).toBe("TODO");
    expect((await workerTaskStatus(mine.id, "IN_PROGRESS")).ok).toBe(true);
    expect((await workerTaskStatus(mine.id, "COMPLETED")).ok).toBe(true);
    const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: pm.id, title: { contains: "completed by" } } })).toBeGreaterThan(0);
  });

  it("a material request becomes a purchase request waiting for the project manager", async () => {
    await loginAs("w-00001@workers.local");
    expect((await workerRequestMaterial(fd({ item: "", quantity: 2 }))).ok).toBe(false);
    expect((await workerRequestMaterial(fd({ item: "Wood screws 2 inch", quantity: 5, unit: "box" }))).ok).toBe(true);
    const pr = await db.purchaseRequest.findFirstOrThrow({ where: { items: { some: { description: "Wood screws 2 inch" } } } });
    expect(pr.status).toBe("PENDING_APPROVAL");
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: pr.id, status: "PENDING" } });
    expect(ap.requiredRole).toBe("PROJECT_MANAGER");
  });

  it("a worker can report a problem, and cannot use staff screens' actions", async () => {
    await loginAs("w-00001@workers.local");
    expect((await workerReportIssue(fd({ issue: "x" }))).ok).toBe(false);
    expect((await workerReportIssue(fd({ issue: "Water leaking near the kitchen wall" }))).ok).toBe(true);
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: sup.id, body: { contains: "Water leaking" } } })).toBe(1);
    const { createExpense } = await import("@/app/(app)/finance/actions");
    expect((await createExpense(fd({ description: "x", amount: 10, date: new Date().toISOString().slice(0, 10) }))).ok).toBe(false);
  });
});

describe("reports", () => {
  it("every report runs for its owner role and returns consistent totals", async () => {
    const c = await ctxAs("owner@dsc.demo");
    const f = parseFilters({ from: "2020-01-01", to: "2040-01-01" });
    for (const r of REPORTS) {
      const res = await r.run(c, f);
      expect(res.columns.length, r.key).toBeGreaterThan(0);
      for (const row of res.rows) for (const col of res.columns) expect(col.key in row, `${r.key}.${col.key}`).toBe(true);
    }
    const inv = REPORTS.find((r) => r.key === "invoices")!;
    const res = await inv.run(c, f);
    const sumTotal = res.rows.reduce((s, r) => s + Number(r.total), 0);
    expect(Number(res.totals!.total)).toBeCloseTo(sumTotal, 2);
  });

  it("receivables report equals the receivables engine", async () => {
    const c = await ctxAs("accounts@dsc.demo");
    const rep = await REPORTS.find((r) => r.key === "receivables")!.run(c, parseFilters({}));
    const eng = await receivables(c.companyId);
    expect(Number(rep.totals!.balance)).toBeCloseTo(eng.total, 2);
  });

  it("report access follows permissions: no profitability for designers/sales, no payroll-adjacent data for PMs", async () => {
    const designer = await ctxAs("designer@dsc.demo");
    const sales = await ctxAs("sales@dsc.demo");
    const pm = await ctxAs("pm@dsc.demo");
    const keys = (c: typeof designer) => REPORTS.filter((r) => canRun(c, r)).map((r) => r.key);
    expect(keys(designer)).not.toContain("profitability");
    expect(keys(designer)).not.toContain("invoices");
    expect(keys(sales)).not.toContain("profitability");
    expect(keys(sales)).toContain("sales");
    expect(keys(pm)).toContain("profitability");
    expect(keys(pm)).not.toContain("payments");
  });

  it("export honours permissions and formats", async () => {
    await loginAs("accounts@dsc.demo");
    const get = (key: string, q = "format=csv") => reportExport(req(`http://localhost/reports/${key}/export?${q}`), { params: Promise.resolve({ key }) });
    const csv = await get("invoices");
    expect(csv.status).toBe(200);
    expect((await csv.text()).split("\r\n")[0]).toContain("Invoice");
    expect((await get("invoices", "format=xlsx")).headers.get("content-type")).toContain("spreadsheetml");
    expect(Buffer.from(await (await get("invoices", "format=pdf")).arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await get("leads")).status).toBe(403);
    logout();
    expect((await get("invoices")).status).toBe(403);
  });

  it("a sales rep's lead report contains only their own leads", async () => {
    const c = await ctxAs("sales@dsc.demo");
    const res = await REPORTS.find((r) => r.key === "leads")!.run(c, parseFilters({ from: "2020-01-01", to: "2040-01-01" }));
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.owner === "Rohan Mehta")).toBe(true);
  });
});

describe("global search", () => {
  it("finds records the user may see and hides the rest", async () => {
    const sales = await ctxAs("sales@dsc.demo");
    const mine = await globalSearch(sales, "Vikas");
    expect(mine.find((g) => g.key === "leads")?.hits.length).toBe(1);
    expect(await globalSearch(sales, "Imran")).toEqual([]); // another rep's lead
    expect(await globalSearch(sales, "x")).toEqual([]); // too short
    const salesVendors = (await globalSearch(sales, "Greenply")).map((g) => g.key);
    expect(salesVendors).not.toContain("vendors");
    const proc = await ctxAs("procurement@dsc.demo");
    expect((await globalSearch(proc, "Greenply")).map((g) => g.key)).toContain("vendors");
    const owner = await ctxAs("owner@dsc.demo");
    expect((await globalSearch(owner, "PRJ-00001")).map((g) => g.key)).toContain("projects");
    expect((await globalSearch(owner, "Imran")).map((g) => g.key)).toContain("leads");
  });
});

describe("executive dashboard", () => {
  it("period parsing", () => {
    const m = resolvePeriod("month");
    expect(m.from.getDate()).toBe(1);
    expect(resolvePeriod("nonsense").key).toBe("month");
    const c = resolvePeriod("custom", "2030-01-01", "2030-01-31");
    expect(c.to.getTime() - c.from.getTime()).toBe(31 * 86400000);
    expect(resolvePeriod("custom", "2030-02-01", "2030-01-01").to.getTime()).toBeGreaterThan(resolvePeriod("custom", "2030-02-01", "2030-01-01").from.getTime());
  });

  it("headline numbers match the underlying records", async () => {
    const companyId = (await db.company.findFirstOrThrow()).id;
    const p = resolvePeriod("year");
    const s = await executiveStats(companyId, p.from, p.to);
    expect(s.activeProjects).toBe(await db.project.count({ where: { companyId, deletedAt: null, status: { in: ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT", "EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER"] } } }));
    expect(s.pendingApprovals).toBe(await db.approval.count({ where: { companyId, status: "PENDING" } }));
    expect(s.workers).toBe(await db.worker.count({ where: { companyId, deletedAt: null, isActive: true } }));
    const rec = await receivables(companyId);
    expect(s.receivable).toBeCloseTo(rec.total, 2);
    const stock = await db.stockBalance.findMany({ where: { companyId, quantity: { gt: 0 } } });
    expect(s.inventoryValue).toBeCloseTo(stock.reduce((a, b) => a + Number(b.quantity) * Number(b.avgCost), 0), 0);
    expect(s.flow).toHaveLength(6);
    expect(s.profitability.length).toBeGreaterThan(0);
  });
});
