import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { companyProfit, fyLabel, fyMonths, fyOf } from "@/lib/company-profit";
import { saveCompanyCharge } from "@/app/(app)/finance/profit/actions";

beforeEach(() => logout());

describe("financial years", () => {
  it("April to March, named by the year it starts", () => {
    expect(fyOf(new Date("2026-04-01T00:00:00+05:30"))).toBe(2026);
    expect(fyOf(new Date("2027-03-31T12:00:00+05:30"))).toBe(2026);
    expect(fyOf(new Date("2027-04-01T00:00:00+05:30"))).toBe(2027);
    expect(fyLabel(2026)).toBe("2026-27");
    const m = fyMonths(2026);
    expect(m[0].key).toBe("2026-04");
    expect(m[11].key).toBe("2027-03");
  });
});

describe("company profit", () => {
  it("works out gross profit, EBITDA and net profit for a month from completed projects only", async () => {
    // a year no other test uses, so the numbers can be checked by hand
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const done = await db.project.create({ data: { companyId: company.id, code: `PRJ-CP${Date.now().toString(36)}`, name: "Finished site", clientId: client.id, status: "COMPLETED", actualEndDate: new Date("2031-06-15T10:00:00+05:30"), contractValue: 1000000 } });
    const running = await db.project.create({ data: { companyId: company.id, code: `PRJ-CQ${Date.now().toString(36)}`, name: "Running site", clientId: client.id, status: "EXECUTION", contractValue: 5000000 } });
    await db.expense.create({ data: { companyId: company.id, projectId: done.id, category: "MATERIAL", description: "Plywood", amount: 600000, date: new Date("2031-05-20"), approved: true } });
    await db.expense.create({ data: { companyId: company.id, projectId: running.id, category: "MATERIAL", description: "Not counted", amount: 999999, date: new Date("2031-06-02"), approved: true } });
    await db.expense.create({ data: { companyId: company.id, projectId: null, category: "OFFICE", description: "Office rent", amount: 50000, date: new Date("2031-06-10T10:00:00+05:30"), approved: true } });
    await db.expense.create({ data: { companyId: company.id, projectId: null, category: "OFFICE", description: "Not approved", amount: 77777, date: new Date("2031-06-11T10:00:00+05:30"), approved: false } });
    const emp = await db.employee.findFirstOrThrow({ where: { companyId: company.id } });
    await db.payslip.create({ data: { companyId: company.id, employeeId: emp.id, month: 6, year: 2031, basic: 30000, hra: 10000 } });

    await loginAs("owner@dsc.demo");
    expect((await saveCompanyCharge(fd({ period: "2031-06", kind: "DEPRECIATION", amount: 5000 }))).ok).toBe(true);
    expect((await saveCompanyCharge(fd({ period: "2031-06", kind: "TAX", amount: 20000 }))).ok).toBe(true);

    const p = await companyProfit(company.id);
    const june = p.months.get("2031-06")!;
    expect(june.projects).toBe(1);
    expect(june.revenue).toBe(1000000);
    expect(june.directCost).toBe(600000);
    expect(june.grossProfit).toBe(400000);
    expect(june.overheads).toBe(90000); // 50,000 office (the unapproved one is left out) + 40,000 salaries
    expect(june.ebitda).toBe(310000);
    expect(june.netProfit).toBe(285000);
    expect(p.years).toContain(2031);
    expect(p.chargeMonths.has("2031-06")).toBe(true);
    // the running project's cost and value are not counted anywhere
    expect([...p.months.values()].some((c) => c.material === 999999)).toBe(false);
    expect(p.projects.find((x) => x.id === running.id)).toBeUndefined();
    expect(p.projects.find((x) => x.id === done.id)?.fy).toBe(2031);

    // saving a month and kind again replaces the amount; zero removes it
    await saveCompanyCharge(fd({ period: "2031-06", kind: "TAX", amount: 0 }));
    expect((await companyProfit(company.id)).months.get("2031-06")!.netProfit).toBe(305000);
  });

  it("only people who may see company finance and margins can enter charges", async () => {
    await loginAs("sales@dsc.demo");
    expect((await saveCompanyCharge(fd({ period: "2031-06", kind: "TAX", amount: 1 }))).ok).toBe(false);
    await loginAs("owner@dsc.demo");
    expect((await saveCompanyCharge(fd({ period: "June", kind: "TAX", amount: 1 }))).ok).toBe(false);
    expect((await saveCompanyCharge(fd({ period: "2031-06", kind: "TAX", amount: -5 }))).ok).toBe(false);
  });
});
