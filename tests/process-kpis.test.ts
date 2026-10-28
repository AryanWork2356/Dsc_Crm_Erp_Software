import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs, logout } from "./setup";
import { kpiReport } from "@/lib/kpis";

beforeEach(() => logout());

const DAY = 86400000;
let seq = 0;
const tag = () => `${Date.now().toString(36)}${seq++}`;

/** A person who can see exactly one new project, so the numbers can be checked by hand. */
async function isolated() {
  const company = await db.company.findFirstOrThrow();
  const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
  const user = await db.user.create({ data: { companyId: company.id, email: `kpi-${tag()}@dsc.demo`, name: "KPI tester", role: "PROJECT_MANAGER", passwordHash: "x" } });
  const project = await db.project.create({ data: { companyId: company.id, code: `PRJ-K${tag()}`, name: "KPI site", clientId: client.id, status: "EXECUTION", projectManagerId: user.id, contractValue: 1000000, budget: 600000, members: { create: [{ userId: user.id, roleLabel: "PM" }] } } });
  await loginAs(user.email);
  return { company, user, project, ctx: (await getCtx())! };
}
const find = (r: Awaited<ReturnType<typeof kpiReport>>, key: string) => r.kpis.find((k) => k.key === key)!;

describe("key numbers", () => {
  it("every number carries its definition and what it is based on", async () => {
    const { ctx } = await isolated();
    const r = await kpiReport(ctx);
    expect(r.kpis.length).toBeGreaterThanOrEqual(5);
    for (const k of r.kpis) {
      expect(k.definition.length, k.key).toBeGreaterThan(30);
      expect(k.basis.length, k.key).toBeGreaterThan(0);
    }
    expect(r.notYet.some((n) => /EBITDA/.test(n.label))).toBe(false); // EBITDA now has its own page: Company profit
  });

  it("shows a dash, not a percentage, when there are too few records", async () => {
    const { ctx, project, company } = await isolated();
    await db.projectMilestone.create({ data: { companyId: company.id, projectId: project.id, name: "Only one", dueDate: new Date(Date.now() - 5 * DAY), completedAt: new Date(Date.now() - 6 * DAY) } });
    expect(find(await kpiReport(ctx), "milestones").value).toBe("—");
  });

  it("counts milestones on time against their date; a late or unfinished one does not count", async () => {
    const { ctx, project, company } = await isolated();
    const mk = (name: string, due: number, done: number | null) => db.projectMilestone.create({ data: { companyId: company.id, projectId: project.id, name, dueDate: new Date(Date.now() + due * DAY), completedAt: done == null ? null : new Date(Date.now() + done * DAY) } });
    await mk("A", -20, -22); // on time
    await mk("B", -18, -18); // on the day
    await mk("C", -15, -10); // late
    await mk("D", -12, null); // never done
    await mk("E", -9, -12); // on time
    await mk("F", 10, null); // not due yet: not counted
    const k = find(await kpiReport(ctx), "milestones");
    expect(k.value).toBe("60 %");
    expect(k.basis).toMatch(/3 of 5/);
  });

  it("plan reliability uses the FIRST committed date, so moving a date does not help", async () => {
    const { ctx, project, company } = await isolated();
    const mk = (code: string, baseline: number, due: number, done: number) => db.projectTask.create({ data: { companyId: company.id, projectId: project.id, code: `T-${tag()}`, name: code, status: "COMPLETED", baselineDue: new Date(Date.now() + baseline * DAY), dueDate: new Date(Date.now() + due * DAY), updatedAt: new Date(Date.now() + done * DAY) } });
    for (let i = 0; i < 4; i++) await mk(`ok${i}`, 2, 2, -1); // finished a day early... due in 2 days
    await mk("moved", -10, 5, -1); // looks on time against the moved date, but the first date was 10 days ago
    const k = find(await kpiReport(ctx), "plan");
    expect(k.basis).toMatch(/4 of 5/);
    expect(k.value).toBe("80 %");
  });

  it("extra work without the client's decision is counted and should be zero", async () => {
    const { ctx, project, company, user } = await isolated();
    expect(find(await kpiReport(ctx), "unapproved").value).toBe("0");
    expect(find(await kpiReport(ctx), "unapproved").tone).toBe("good");
    await db.additionalWork.create({ data: { companyId: company.id, projectId: project.id, number: `EX-${tag()}`, title: "Extra partition", kind: "EMERGENCY", status: "IN_PROGRESS", amount: 25000, requestedById: user.id } });
    const k = find(await kpiReport(ctx), "unapproved");
    expect(k.value).toBe("1");
    expect(k.tone).toBe("bad");
  });

  it("money numbers are hidden from people who cannot see finance", async () => {
    const { ctx } = await isolated();
    expect(ctx.can("finance:view")).toBe(false);
    const keys = (await kpiReport(ctx)).kpis.map((k) => k.key);
    expect(keys).not.toContain("receivables");
    expect(keys).not.toContain("billing");
  });
});
