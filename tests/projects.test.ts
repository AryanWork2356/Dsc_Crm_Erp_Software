import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { changeProjectStatus, createProject, createTask, setTaskStatus, deleteTask, createMilestone, updateMilestone, toggleMilestone, syncBudgetFromBoq, deleteProject, updateProject } from "@/app/(app)/projects/actions";
import { projectFinancials } from "@/lib/project-finance";

beforeEach(() => logout());

const byCode = (code: string) => db.project.findFirstOrThrow({ where: { code } });

describe("project access scoping", () => {
  it("a project manager can only change projects they manage", async () => {
    const p1 = await byCode("PRJ-00001"); // Amit's project
    await loginAs("pm2@dsc.demo"); // Kavita
    const r = await changeProjectStatus(p1.id, "ON_HOLD");
    expect(r.ok).toBe(false);
    expect((await db.project.findUniqueOrThrow({ where: { id: p1.id } })).status).toBe("EXECUTION");
    await loginAs("pm@dsc.demo");
    expect((await changeProjectStatus(p1.id, "QUALITY_CHECK")).ok).toBe(true);
    expect((await changeProjectStatus(p1.id, "EXECUTION")).ok).toBe(true);
  });

  it("management can open any project; a site engineer only the ones they're on", async () => {
    const p4 = await byCode("PRJ-00004"); // no engineer on this one
    await loginAs("engineer@dsc.demo");
    expect((await createTask(p4.id, fd({ name: "Sneaky task" }))).ok).toBe(false);
    await loginAs("director@dsc.demo");
    expect((await createTask(p4.id, fd({ name: "Mgmt task" }))).ok).toBe(true);
  });
});

describe("project creation and editing", () => {
  it("creates a project with sequential code, members and notification to the manager", async () => {
    await loginAs("director@dsc.demo");
    const client = await db.client.findFirstOrThrow({ where: { name: "Sneha Kapoor" } });
    const pm = await db.user.findFirstOrThrow({ where: { email: "pm2@dsc.demo" } });
    const r = await createProject(fd({ name: "Test Villa", clientId: client.id, projectManagerId: pm.id, contractValue: 1000000, startDate: "2030-01-01", plannedEndDate: "2030-06-01" }));
    expect(r.ok).toBe(true);
    const p = await db.project.findFirstOrThrow({ where: { name: "Test Villa" }, include: { members: true } });
    expect(p.code).toMatch(/^PRJ-\d{5}$/);
    expect(p.status).toBe("PLANNING");
    expect(p.members.some((m) => m.userId === pm.id)).toBe(true);
    expect(await db.notification.count({ where: { userId: pm.id, title: { contains: "Test Villa" } } })).toBe(1);
  });

  it("rejects an end date before the start date", async () => {
    await loginAs("director@dsc.demo");
    const client = await db.client.findFirstOrThrow({ where: { name: "Sneha Kapoor" } });
    const r = await createProject(fd({ name: "Bad dates", clientId: client.id, startDate: "2030-06-01", plannedEndDate: "2030-01-01" }));
    expect(r.ok).toBe(false);
  });

  it("users without edit rights are blocked; contract value changes are audited with old and new amounts", async () => {
    const p = await db.project.findFirstOrThrow({ where: { name: "Test Villa" } });
    await loginAs("designer@dsc.demo"); // designer has no projects:edit at all
    expect((await updateProject(p.id, fd({ name: "Test Villa", clientId: p.clientId, contractValue: 1 }))).ok).toBe(false);
    await loginAs("director@dsc.demo");
    const before = Number(p.contractValue);
    expect((await updateProject(p.id, fd({ name: "Test Villa", clientId: p.clientId, contractValue: 1250000 }))).ok).toBe(true);
    expect(before).toBe(1000000);
    expect(Number((await db.project.findUniqueOrThrow({ where: { id: p.id } })).contractValue)).toBe(1250000);
    const log = await db.auditLog.findFirst({ where: { entityId: p.id, summary: { contains: "contract value" } } });
    expect(log?.summary).toContain("10,00,000");
  });
});

describe("tasks and progress", () => {
  let projectId = "";
  const ids: Record<string, string> = {};

  it("project progress is the average of task progress", async () => {
    await loginAs("director@dsc.demo");
    const p = await db.project.findFirstOrThrow({ where: { name: "Test Villa" } });
    projectId = p.id;
    for (const n of ["A", "B", "C", "D"]) await createTask(projectId, fd({ name: `Task ${n}`, dueDate: "2030-02-01" }));
    for (const n of ["A", "B", "C", "D"]) ids[n] = (await db.projectTask.findFirstOrThrow({ where: { projectId, name: `Task ${n}` } })).id;
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).progress).toBe(0);
    await setTaskStatus(ids.A, "COMPLETED");
    await setTaskStatus(ids.B, "IN_PROGRESS", 50);
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).progress).toBe(38); // (100+50+0+0)/4 = 37.5 → 38
  });

  it("dependencies block starting a task until the prerequisite is done", async () => {
    await loginAs("director@dsc.demo");
    const t = await createTask(projectId, fd({ name: "Dependent", dependsOnId: ids.C }));
    expect(t.ok).toBe(true);
    const dep = await db.projectTask.findFirstOrThrow({ where: { projectId, name: "Dependent" } });
    expect((await setTaskStatus(dep.id, "IN_PROGRESS")).ok).toBe(false);
    await setTaskStatus(ids.C, "COMPLETED");
    expect((await setTaskStatus(dep.id, "IN_PROGRESS")).ok).toBe(true);
  });

  it("a task can't depend on a task from another project", async () => {
    await loginAs("director@dsc.demo");
    const other = await db.projectTask.findFirstOrThrow({ where: { project: { code: "PRJ-00001" } } });
    expect((await createTask(projectId, fd({ name: "Cross", dependsOnId: other.id }))).ok).toBe(false);
  });

  it("a project can't be completed while tasks are open; deleting a task re-averages progress", async () => {
    await loginAs("director@dsc.demo");
    expect((await changeProjectStatus(projectId, "COMPLETED")).ok).toBe(false);
    const before = (await db.project.findUniqueOrThrow({ where: { id: projectId } })).progress;
    await deleteTask(ids.D);
    const after = (await db.project.findUniqueOrThrow({ where: { id: projectId } })).progress;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("completing a project stamps the completion date and sets progress to 100", async () => {
    await loginAs("director@dsc.demo");
    const tasks = await db.projectTask.findMany({ where: { projectId, status: { not: "COMPLETED" } } });
    for (const t of tasks) await setTaskStatus(t.id, "COMPLETED");
    expect((await changeProjectStatus(projectId, "COMPLETED")).ok).toBe(true);
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(p.progress).toBe(100);
    expect(p.actualEndDate).not.toBeNull();
  });

  it("a worker-level user cannot create tasks", async () => {
    await loginAs("sales@dsc.demo");
    expect((await createTask(projectId, fd({ name: "No" }))).ok).toBe(false);
  });
});

describe("milestones", () => {
  it("billing percentages can't exceed 100% in total", async () => {
    await loginAs("director@dsc.demo");
    const p = await byCode("PRJ-00002"); // seeded with 30+30+30+10 = 100
    expect((await createMilestone(p.id, fd({ name: "Extra", billingPct: 5 }))).ok).toBe(false);
    const ms = await db.projectMilestone.findFirstOrThrow({ where: { projectId: p.id, billingPct: 10 } });
    expect((await updateMilestone(ms.id, fd({ name: ms.name, billingPct: 15 }))).ok).toBe(false);
    expect((await updateMilestone(ms.id, fd({ name: ms.name, billingPct: 5 }))).ok).toBe(true);
  });

  it("completing a milestone with billing notifies accounts exactly once", async () => {
    await loginAs("pm2@dsc.demo");
    const p = await byCode("PRJ-00004");
    await createMilestone(p.id, fd({ name: "Test stage", billingPct: 0 }));
    const m = await db.projectMilestone.findFirstOrThrow({ where: { projectId: p.id, name: "Advance / mobilisation" } });
    const accounts = await db.user.findFirstOrThrow({ where: { email: "accounts@dsc.demo" } });
    await toggleMilestone(m.id); // complete
    await toggleMilestone(m.id); // reopen
    await toggleMilestone(m.id); // complete again – dedupe key prevents a second alert
    expect(await db.notification.count({ where: { userId: accounts.id, dedupeKey: `ms-done:${m.id}` } })).toBe(1);
  });
});

describe("live profitability", () => {
  it("is computed from real expenses, labour, vendor bills and invoices", async () => {
    const p = await byCode("PRJ-00001");
    const companyId = p.companyId;
    const vendor = await db.vendor.create({ data: { companyId, code: "V-TEST", name: "Test Sub-contractor" } });
    const base = (await projectFinancials(companyId, [p.id])).get(p.id)!; // seeded activity (e.g. material already issued to site)

    await db.expense.create({ data: { companyId, projectId: p.id, category: "MATERIAL", description: "Hardware", amount: 50000, approved: true } });
    await db.expense.create({ data: { companyId, projectId: p.id, category: "TRAVEL", description: "Site travel", amount: 5000, approved: true } });
    await db.expense.create({ data: { companyId, projectId: p.id, category: "MISC", description: "Unapproved", amount: 99999, approved: false } });
    for (let i = 0; i < 10; i++) await db.attendance.create({ data: { companyId, projectId: p.id, date: new Date(2030, 0, i + 1), status: "PRESENT", wageCost: 800 } });
    await db.vendorBill.create({ data: { companyId, number: "VB-T1", vendorId: vendor.id, projectId: p.id, amount: 30000 } });
    // a bill linked to a PO is material (counted via receipts), so it must NOT be added again as "vendor"
    const po = await db.purchaseOrder.create({ data: { companyId, number: "PO-T1", vendorId: vendor.id, projectId: p.id } });
    await db.vendorBill.create({ data: { companyId, number: "VB-T2", vendorId: vendor.id, projectId: p.id, poId: po.id, amount: 77777 } });
    const client = await db.client.findUniqueOrThrow({ where: { id: p.clientId } });
    await db.invoice.create({ data: { companyId, number: "INV-T1", clientId: client.id, projectId: p.id, status: "PARTIALLY_PAID", subtotal: 100000, discount: 0, taxAmount: 18000, total: 118000, paid: 50000 } });
    await db.invoice.create({ data: { companyId, number: "INV-T2", clientId: client.id, projectId: p.id, status: "DRAFT", subtotal: 999999, total: 999999, paid: 0 } });

    const f = (await projectFinancials(companyId, [p.id])).get(p.id)!;
    expect(f.material - base.material).toBe(50000);
    expect(f.labour - base.labour).toBe(8000);
    expect(f.vendor - base.vendor).toBe(30000);
    expect(f.other - base.other).toBe(5000);
    expect(f.actualCost - base.actualCost).toBe(93000);
    expect(f.profit).toBe(Number(p.contractValue) - f.actualCost);
    expect(f.billed - base.billed).toBe(100000); // draft invoice ignored; GST excluded
    expect(f.collected - base.collected).toBe(50000);
    expect(f.outstanding - base.outstanding).toBe(68000);
    expect(f.budget).toBeGreaterThan(0);
    expect(f.overBudget).toBe(false);
  });

  it("flags over-budget projects and reports variance", async () => {
    const p = await byCode("PRJ-00001");
    const before = (await projectFinancials(p.companyId, [p.id])).get(p.id)!;
    await db.expense.create({ data: { companyId: p.companyId, projectId: p.id, category: "MISC", description: "Big overrun", amount: before.budget, approved: true } });
    const f = (await projectFinancials(p.companyId, [p.id])).get(p.id)!;
    expect(f.overBudget).toBe(true);
    expect(f.variance).toBe(f.actualCost - f.budget);
    expect(f.variancePct).toBeGreaterThan(0);
  });

  it("handles a project with no activity", async () => {
    const p = await byCode("PRJ-00003");
    const f = (await projectFinancials(p.companyId, [p.id])).get(p.id)!;
    expect(f.actualCost).toBe(0);
    expect(f.profit).toBe(Number(p.contractValue));
    expect(f.marginPct).toBe(100);
  });

  it("sets the budget from the BOQ and refuses without cost access", async () => {
    const p = await byCode("PRJ-00003");
    await loginAs("director@dsc.demo");
    expect((await syncBudgetFromBoq(p.id)).ok).toBe(true);
    const boq = await db.boq.findFirstOrThrow({ where: { projectId: p.id }, include: { items: true } });
    const cost = boq.items.reduce((s, i) => s + Number(i.estimatedCost), 0);
    expect(Number((await db.project.findUniqueOrThrow({ where: { id: p.id } })).budget)).toBeCloseTo(cost, 2);
    await loginAs("supervisor@dsc.demo");
    expect((await syncBudgetFromBoq(p.id)).ok).toBe(false);
  });

  it("projects with financial records can't be deleted", async () => {
    const p = await byCode("PRJ-00001");
    await loginAs("owner@dsc.demo");
    expect((await deleteProject(p.id)).ok).toBe(false);
    const villa = await db.project.findFirstOrThrow({ where: { name: "Test Villa" } });
    expect((await deleteProject(villa.id)).ok).toBe(true);
  });
});
