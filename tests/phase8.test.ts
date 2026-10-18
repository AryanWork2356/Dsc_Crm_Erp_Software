import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { loginAs, logout } from "./setup";
import { monthlyReport, runWeeklyDigest, weeklyReport } from "@/lib/director-reports";
import { payables, receivables } from "@/lib/finance-stats";
import { GET as reportPdf } from "@/app/(app)/director-reports/pdf/route";

beforeEach(() => logout());
const company = () => db.company.findFirstOrThrow();

describe("weekly director report", () => {
  it("agrees with the payables and receivables screens", async () => {
    const c = await company();
    const [r, pay, rec] = await Promise.all([weeklyReport(c.id), payables(c.id), receivables(c.id)]);
    expect(r.payables.total).toBe(pay.total);
    expect(r.payables.overdue).toBe(pay.overdueTotal);
    expect(r.receivables.total).toBe(rec.total);
    expect(r.receivables.overdue).toBe(rec.overdueTotal);
    expect(r.forecast.net).toBeCloseTo(r.forecast.in - r.forecast.out, 2);
    expect(r.cashFlow).toHaveLength(6);
    expect(r.payables.byVendor.reduce((s, v) => s + v.total, 0)).toBeLessThanOrEqual(pay.total + 0.01);
  });

  it("lists high-risk invoices (over 60 days late) and critical vendors (over 30 days)", async () => {
    const c = await company();
    const client = await db.client.findFirstOrThrow({ where: { companyId: c.id } });
    const inv = await db.invoice.create({ data: { companyId: c.id, number: "HR-OLD-1", clientId: client.id, status: "SENT", total: 50000, paid: 0, issueDate: new Date(Date.now() - 120 * 86400000), dueDate: new Date(Date.now() - 100 * 86400000) } });
    const vendor = await db.vendor.findFirstOrThrow({ where: { companyId: c.id } });
    await db.vendorBill.create({ data: { companyId: c.id, number: "CRIT-1", vendorId: vendor.id, amount: 30000, billDate: new Date(Date.now() - 80 * 86400000), dueDate: new Date(Date.now() - 50 * 86400000), certRequired: false } });
    const r = await weeklyReport(c.id);
    const hit = r.highRisk.find((h) => h.id === inv.id);
    expect(hit?.daysLate).toBeGreaterThanOrEqual(99);
    expect(hit?.balance).toBe(50000);
    expect(r.criticalVendors.find((v) => v.name === vendor.name)?.overdue31plus).toBeGreaterThanOrEqual(30000);
  });

  it("counts bills waiting for certification and what is due this week", async () => {
    const c = await company();
    const vendor = await db.vendor.findFirstOrThrow({ where: { companyId: c.id } });
    const before = await weeklyReport(c.id);
    await db.vendorBill.create({ data: { companyId: c.id, number: "WK-1", vendorId: vendor.id, amount: 12000, billDate: new Date(), dueDate: new Date(Date.now() + 3 * 86400000), certRequired: true } });
    const after = await weeklyReport(c.id);
    expect(after.payables.notCertified).toBe(before.payables.notCertified + 1);
    expect(after.payables.dueThisWeek).toBeCloseTo(before.payables.dueThisWeek + 12000, 2);
  });

  it("is announced to the Owner and Management on Monday morning only, once per week", async () => {
    const c = await company();
    const owner = await db.user.findFirstOrThrow({ where: { email: "owner@dsc.demo" } });
    const count = () => db.notification.count({ where: { userId: owner.id, title: "Weekly report is ready" } });
    const before = await count();
    expect((await runWeeklyDigest(c.id, new Date("2026-03-03T05:00:00Z"))).sent).toBe(false); // Tuesday
    expect((await runWeeklyDigest(c.id, new Date("2026-03-01T05:00:00Z"))).sent).toBe(false); // Sunday
    expect((await runWeeklyDigest(c.id, new Date("2026-03-02T01:00:00Z"))).sent).toBe(false); // Monday 06:30 IST – too early
    expect((await runWeeklyDigest(c.id, new Date("2026-03-02T04:00:00Z"))).sent).toBe(true); // Monday 09:30 IST
    await runWeeklyDigest(c.id, new Date("2026-03-02T09:00:00Z")); // later the same day: no second copy
    expect(await count()).toBe(before + 1);
    const n = await db.notification.findFirstOrThrow({ where: { userId: owner.id, title: "Weekly report is ready" }, orderBy: { createdAt: "desc" } });
    expect(n.body).toMatch(/To collect/);
    expect(n.link).toBe("/director-reports");
  });
});

describe("monthly director report", () => {
  it("adds up turnover and collections for the month and ranks projects by margin", async () => {
    const c = await company();
    const client = await db.client.findFirstOrThrow({ where: { companyId: c.id } });
    await db.invoice.create({ data: { companyId: c.id, number: "MR-1", clientId: client.id, status: "SENT", subtotal: 100000, discount: 10000, total: 106200, paid: 0, issueDate: new Date("2031-05-10T00:00:00Z") } });
    await db.invoice.create({ data: { companyId: c.id, number: "MR-2", clientId: client.id, status: "DRAFT", subtotal: 999999, total: 999999, issueDate: new Date("2031-05-11T00:00:00Z") } }); // drafts don't count
    const inv = await db.invoice.findFirstOrThrow({ where: { number: "MR-1" } });
    await db.payment.create({ data: { companyId: c.id, invoiceId: inv.id, amount: 40000, date: new Date("2031-05-20T00:00:00Z"), method: "BANK_TRANSFER" } });
    const r = await monthlyReport(c.id, 2031, 5);
    expect(r.label).toBe("May 2031");
    expect(r.billed).toBe(90000);
    expect(r.invoicesIssued).toBe(1);
    expect(r.collected).toBe(40000);
    const empty = await monthlyReport(c.id, 2031, 6);
    expect(empty.billed).toBe(0);
    expect(empty.collected).toBe(0);
    const live = await monthlyReport(c.id, new Date().getUTCFullYear(), new Date().getUTCMonth() + 1);
    expect(live.profitability.best.length).toBeGreaterThan(0);
    const margins = live.profitability.best.map((x) => x.marginPct);
    expect(margins).toEqual([...margins].sort((a, b) => b - a));
  });
});

describe("report PDFs and access", () => {
  const get = (q: string) => reportPdf(new NextRequest(`http://localhost/director-reports/pdf${q}`));

  it("weekly and monthly PDFs open for finance roles only", async () => {
    await loginAs("owner@dsc.demo");
    for (const q of ["", "?kind=weekly", "?kind=monthly&month=2031-05"]) {
      const r = await get(q);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/pdf");
      expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(1500);
    }
    await loginAs("accounts@dsc.demo");
    expect((await get("")).status).toBe(200);
    for (const who of ["sales@dsc.demo", "supervisor@dsc.demo", "pm@dsc.demo"]) {
      await loginAs(who);
      expect((await get("")).status).toBe(403);
    }
    logout();
    expect((await get("")).status).toBe(403);
  });
});
