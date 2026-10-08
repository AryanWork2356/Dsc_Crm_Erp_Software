import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs } from "../tests/setup";
import { leadScope } from "@/lib/scope";
import { globalSearch } from "@/lib/search";
import { executiveStats, resolvePeriod } from "@/lib/dashboard";
import { REPORTS } from "@/lib/reports";
import { parseFilters } from "@/lib/report-filters";
import { receivables, monthlyCashFlow } from "@/lib/finance-stats";
import { calendarDay } from "@/lib/utils";

const BUDGET_MS = 1500; // every screen's data must load in under 1.5 s with this much data
const results: [string, number][] = [];

async function time<T>(label: string, fn: () => Promise<T>) {
  const t = performance.now();
  const r = await fn();
  const ms = Math.round(performance.now() - t);
  results.push([label, ms]);
  return r;
}

describe("performance with 10k leads, 10k tasks, 100k stock movements, 100k attendance rows", () => {
  it("has the expected volume", async () => {
    expect(await db.lead.count()).toBeGreaterThanOrEqual(10000);
    expect(await db.inventoryTransaction.count()).toBeGreaterThanOrEqual(100000);
    expect(await db.attendance.count()).toBeGreaterThanOrEqual(100000);
    expect(await db.projectTask.count()).toBeGreaterThanOrEqual(10000);
  });

  it("every heavy screen loads fast", async () => {
    await loginAs("owner@dsc.demo");
    const c = (await getCtx())!;
    const f = parseFilters({ from: "2020-01-01", to: "2040-01-01" });

    await time("Leads list: page 1 + count", () => Promise.all([db.lead.findMany({ where: leadScope(c), orderBy: { createdAt: "desc" }, take: 20 }), db.lead.count({ where: leadScope(c) })]));
    await time("Leads list: search 'Patil' + stage filter", () => db.lead.findMany({ where: { ...leadScope(c), stage: "NEGOTIATION", OR: [{ name: { contains: "Patil", mode: "insensitive" } }, { phone: { contains: "9800" } }] }, orderBy: { createdAt: "desc" }, take: 20 }));
    await time("Leads pipeline board (400 cards)", () => db.lead.findMany({ where: leadScope(c), orderBy: { updatedAt: "desc" }, take: 400 }));
    await time("Leads: deep page 400 of 500", () => db.lead.findMany({ where: leadScope(c), orderBy: { createdAt: "desc" }, skip: 399 * 20, take: 20 }));
    await time("Global search 'Sharma'", () => globalSearch(c, "Sharma"));
    await time("Stock ledger: page 1", () => Promise.all([db.inventoryTransaction.findMany({ where: { companyId: c.companyId }, orderBy: { createdAt: "desc" }, take: 30 }), db.inventoryTransaction.count({ where: { companyId: c.companyId } })]));
    await time("Stock ledger: one material", () => { return db.material.findFirstOrThrow().then((m) => db.inventoryTransaction.findMany({ where: { companyId: c.companyId, materialId: m.id }, orderBy: { createdAt: "desc" }, take: 30 })); });
    await time("Attendance sheet: one site, one day", async () => { const p = await db.project.findFirstOrThrow({ orderBy: { code: "asc" } }); return Promise.all([db.worker.findMany({ where: { companyId: c.companyId, isActive: true, OR: [{ currentProjectId: p.id }, { attendance: { some: { projectId: p.id, date: calendarDay() } } }] }, take: 600 }), db.attendance.findMany({ where: { companyId: c.companyId, date: calendarDay() } })]); });
    await time("Tasks list (my + all)", () => Promise.all([db.projectTask.findMany({ where: { companyId: c.companyId, status: { not: "COMPLETED" } }, orderBy: [{ dueDate: "asc" }], take: 25 }), db.projectTask.count({ where: { companyId: c.companyId, status: { not: "COMPLETED" } } })]));
    await time("Executive dashboard (year)", async () => { const p = resolvePeriod("year"); return executiveStats(c.companyId, p.from, p.to); });
    await time("Cash flow 6 months", () => monthlyCashFlow(c.companyId, 6));
    await time("Receivables", () => receivables(c.companyId));
    for (const key of ["attendance", "labour", "inventory", "consumption", "leads", "invoices", "profitability"]) {
      const r = REPORTS.find((x) => x.key === key)!;
      await time(`Report: ${key}`, () => r.run(c, f));
    }
    console.table(results.map(([label, ms]) => ({ screen: label, ms })));
    const slow = results.filter(([, ms]) => ms >= BUDGET_MS);
    expect(slow, `slower than ${BUDGET_MS}ms: ${slow.map(([l, ms]) => `${l} (${ms}ms)`).join(", ")}`).toEqual([]);
  });

  it("indexes are being used for the common list filters", async () => {
    const plan = (await db.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN SELECT * FROM "Lead" WHERE "companyId" = (SELECT id FROM "Company" LIMIT 1) AND stage = 'NEW' ORDER BY "createdAt" DESC LIMIT 20`)).map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).not.toMatch(/Seq Scan on "Lead"/);
  });
});
