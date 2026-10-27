import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs, logout, fd } from "./setup";
import { createProject, updateProject, createTask, updateTask } from "@/app/(app)/projects/actions";
import { createActionItem, reassignActionItem, resolveActionItem, startActionItem, cancelActionItem } from "@/app/(app)/actions/actions";
import { raiseAction, resolveActionsFor } from "@/lib/action-items";
import { getTimeLimitItems, runTimeLimitReminders } from "@/lib/time-limits";
import { exceptionReport } from "@/lib/exceptions";
import { slippedDays } from "@/lib/baseline";
import { NAV } from "@/lib/nav";

beforeEach(() => logout());

const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const pmUser = () => db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });

describe("committed dates keep a baseline", () => {
  let projectId = "";
  let clientId = "";
  let taskId = "";
  const projFd = (over: Record<string, string> = {}) => fd({ name: "Baseline test project", clientId, segment: "RESIDENTIAL", ...over });

  it("the first end date becomes the baseline; moving it needs a written reason and is logged", async () => {
    await loginAs("owner@dsc.demo");
    clientId = (await db.client.findFirstOrThrow({ where: { deletedAt: null } })).id;
    const r = await createProject(projFd({ plannedEndDate: iso(30) }));
    expect(r.ok).toBe(true);
    projectId = (r as unknown as { data: { id: string } }).data.id;
    let p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(p.baselineEndDate?.toISOString().slice(0, 10)).toBe(iso(30));

    expect((await updateProject(projectId, projFd({ plannedEndDate: iso(45) }))).ok).toBe(false); // no reason
    expect((await updateProject(projectId, projFd({ plannedEndDate: iso(45), dateChangeReason: "ok" }))).ok).toBe(false); // too short
    expect((await updateProject(projectId, projFd({ plannedEndDate: iso(45), dateChangeReason: "Client changed the drawings" }))).ok).toBe(true);
    p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(p.plannedEndDate?.toISOString().slice(0, 10)).toBe(iso(45));
    expect(p.baselineEndDate?.toISOString().slice(0, 10)).toBe(iso(30)); // the first date is never lost
    expect(slippedDays(p.baselineEndDate, p.plannedEndDate)).toBe(15);
    const log = await db.dateChange.findMany({ where: { entityType: "Project", entityId: projectId } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ reason: "Client changed the drawings", field: "plannedEndDate" });

    // changing something else, or saving the same date, needs no reason and writes no log
    expect((await updateProject(projectId, projFd({ plannedEndDate: iso(45), siteAddress: "Thane" }))).ok).toBe(true);
    expect(await db.dateChange.count({ where: { entityType: "Project", entityId: projectId } })).toBe(1);
  });

  it("a project with no date can be given one without a reason, and it becomes the baseline", async () => {
    await loginAs("owner@dsc.demo");
    const r = await createProject(projFd({ name: "No date yet" }));
    const id = (r as unknown as { data: { id: string } }).data.id;
    expect((await db.project.findUniqueOrThrow({ where: { id } })).baselineEndDate).toBeNull();
    expect((await updateProject(id, projFd({ name: "No date yet", plannedEndDate: iso(60) }))).ok).toBe(true);
    expect((await db.project.findUniqueOrThrow({ where: { id } })).baselineEndDate?.toISOString().slice(0, 10)).toBe(iso(60));
    expect(await db.dateChange.count({ where: { entityType: "Project", entityId: id } })).toBe(0);
  });

  it("task due dates work the same way", async () => {
    await loginAs("owner@dsc.demo");
    const r = await createTask(projectId, fd({ name: "Carpentry zone A", dueDate: iso(10) }));
    expect(r.ok).toBe(true);
    const t = await db.projectTask.findFirstOrThrow({ where: { projectId, name: "Carpentry zone A" } });
    taskId = t.id;
    expect(t.baselineDue?.toISOString().slice(0, 10)).toBe(iso(10));
    expect((await updateTask(taskId, fd({ name: "Carpentry zone A", dueDate: iso(14) }))).ok).toBe(false);
    expect((await updateTask(taskId, fd({ name: "Carpentry zone A", dueDate: iso(14), dateChangeReason: "Plywood arrives late" }))).ok).toBe(true);
    const after = await db.projectTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(slippedDays(after.baselineDue, after.dueDate)).toBe(4);
    expect(await db.dateChange.count({ where: { entityType: "ProjectTask", entityId: taskId } })).toBe(1);
  });
});

describe("the action and blocker register", () => {
  let actionId = "";

  it("anyone who can raise one gives it an owner and a due date, and the owner is told", async () => {
    await loginAs("supervisor@dsc.demo");
    const pm = await pmUser();
    const r = await createActionItem(fd({ title: "Only 4 of 8 carpenters came", severity: "HIGH", ownerId: pm.id, dueDate: iso(1) }));
    expect(r.ok).toBe(true);
    actionId = (r as unknown as { data: { id: string } }).data.id;
    const a = await db.actionItem.findUniqueOrThrow({ where: { id: actionId } });
    expect(a).toMatchObject({ status: "OPEN", severity: "HIGH", ownerId: pm.id });
    expect(a.number).toMatch(/^ACT-\d{5}$/);
    expect(await db.notification.count({ where: { userId: pm.id, dedupeKey: `action:${actionId}:new` } })).toBe(1);
    expect((await createActionItem(fd({ title: "" }))).ok).toBe(false);
    expect((await createActionItem(fd({ title: "x", ownerId: (await db.user.findFirstOrThrow({ where: { role: "CLIENT" } })).id }))).ok).toBe(false); // owner must be staff
  });

  it("without a due date it is set from the severity", async () => {
    await loginAs("pm@dsc.demo");
    const r = await createActionItem(fd({ title: "Check cable delivery", severity: "LOW" }));
    const a = await db.actionItem.findUniqueOrThrow({ where: { id: (r as unknown as { data: { id: string } }).data.id } });
    expect(Math.round((a.dueDate.getTime() - Date.now()) / 86400000)).toBeGreaterThanOrEqual(6);
  });

  it("only the owner, the person who raised it, the project manager or a director can change it", async () => {
    await loginAs("store@dsc.demo");
    expect((await startActionItem(actionId)).ok).toBe(false);
    expect((await resolveActionItem(actionId, fd({ resolution: "done" }))).ok).toBe(false);
    await loginAs("supervisor@dsc.demo"); // raised it
    expect((await startActionItem(actionId)).ok).toBe(true);
    expect((await startActionItem(actionId)).ok).toBe(false); // already in progress
  });

  it("resolving needs a written result; changing owner or date needs a reason", async () => {
    await loginAs("pm@dsc.demo");
    expect((await resolveActionItem(actionId, fd({ resolution: "" }))).ok).toBe(false);
    const dir = await db.user.findFirstOrThrow({ where: { email: "director@dsc.demo" } });
    expect((await reassignActionItem(actionId, fd({ ownerId: dir.id, dueDate: iso(2) }))).ok).toBe(false);
    expect((await reassignActionItem(actionId, fd({ ownerId: dir.id, dueDate: iso(2), reason: "Needs a director to call the vendor" }))).ok).toBe(true);
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: actionId } })).ownerId).toBe(dir.id);
    await loginAs("director@dsc.demo");
    expect((await resolveActionItem(actionId, fd({ resolution: "Vendor sent 4 more carpenters at 11 am" }))).ok).toBe(true);
    const done = await db.actionItem.findUniqueOrThrow({ where: { id: actionId } });
    expect(done).toMatchObject({ status: "RESOLVED", resolution: "Vendor sent 4 more carpenters at 11 am" });
    expect((await cancelActionItem(actionId, fd({ reason: "x" }))).ok).toBe(false); // already closed
  });

  it("the app can raise an action itself once per source, and close it when the source is fixed", async () => {
    const owner = await pmUser();
    const company = await db.company.findFirstOrThrow();
    const base = { companyId: company.id, title: "Delivery late: plywood", ownerId: owner.id, createdById: owner.id, dueDate: new Date(Date.now() + 86400000), sourceType: "TestSource", sourceId: "src-1" };
    const first = await raiseAction(db, base);
    const second = await raiseAction(db, base);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.action.id).toBe(first.action.id);
    await resolveActionsFor(db, company.id, "TestSource", "src-1", owner.id, "Delivered");
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: first.action.id } })).status).toBe("RESOLVED");
    expect((await raiseAction(db, base)).created).toBe(true); // a new problem with the same source can be raised again
  });
});

describe("late actions are chased: owner, then manager, then directors, once each", () => {
  it("a critical action is overdue at its due time; reminders never repeat", async () => {
    const company = await db.company.findFirstOrThrow();
    const owner = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    const project = await db.project.findFirstOrThrow({ where: { projectManagerId: { not: null }, deletedAt: null } });
    const a = await db.actionItem.create({ data: { companyId: company.id, number: "ACT-TEST1", title: "Crew missing at site", severity: "CRITICAL", ownerId: owner.id, createdById: owner.id, projectId: project.id, dueDate: new Date(Date.now() - 3600000) } });
    const items = await getTimeLimitItems(company.id);
    const hit = items.find((i) => i.ruleKey === "action_overdue" && i.id === a.id);
    expect(hit?.state).toBe("overdue");
    await runTimeLimitReminders(company.id);
    await runTimeLimitReminders(company.id);
    expect(await db.notification.count({ where: { userId: owner.id, dedupeKey: `tat:action_overdue:${a.id}:L1` } })).toBe(1);
    await db.actionItem.update({ where: { id: a.id }, data: { status: "RESOLVED" } });
    const after = await getTimeLimitItems(company.id);
    expect(after.some((i) => i.ruleKey === "action_overdue" && i.id === a.id)).toBe(false); // a resolved action drops off the board
  });

  it("a low action is not overdue the same hour it is due", async () => {
    const company = await db.company.findFirstOrThrow();
    const owner = await pmUser();
    const a = await db.actionItem.create({ data: { companyId: company.id, number: "ACT-TEST2", title: "Tidy store", severity: "LOW", ownerId: owner.id, createdById: owner.id, dueDate: new Date(Date.now() - 3600000) } });
    expect((await getTimeLimitItems(company.id)).some((i) => i.id === a.id && i.state === "overdue")).toBe(false);
    await db.actionItem.delete({ where: { id: a.id } });
  });
});

describe("the exceptions report", () => {
  it("lists real gaps and links each to its record; everything it lists is true", async () => {
    await loginAs("owner@dsc.demo");
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const r = await createProject(fd({ name: "Exception probe", clientId: client.id }));
    const id = (r as unknown as { data: { id: string } }).data.id;
    await db.project.update({ where: { id }, data: { status: "EXECUTION" } });
    const rep = await exceptionReport((await getCtx())!);
    const has = (key: string) => rep.sections.find((s) => s.key === key)?.rows.some((x) => x.id === id);
    expect(has("no_owner")).toBe(true);
    expect(has("no_budget")).toBe(true);
    expect(has("no_schedule")).toBe(true);
    expect(has("no_update")).toBe(true);
    for (const s of rep.sections) for (const row of s.rows) expect(row.link.startsWith("/")).toBe(true);

    // give it an owner, a date, a budget and a report: it drops off those lists
    const pm = await pmUser();
    await db.project.update({ where: { id }, data: { projectManagerId: pm.id, plannedEndDate: new Date(Date.now() + 20 * 86400000), baselineEndDate: new Date(Date.now() + 20 * 86400000), budget: 100000 } });
    await db.dailyReport.create({ data: { companyId: client.companyId, projectId: id, reportDate: new Date(new Date().toISOString().slice(0, 10)), kind: "MORNING", submittedById: pm.id } });
    const rep2 = await exceptionReport((await getCtx())!);
    const has2 = (key: string) => rep2.sections.find((s) => s.key === key)?.rows.some((x) => x.id === id);
    for (const key of ["no_owner", "no_budget", "no_schedule", "no_update"]) expect(has2(key), key).not.toBe(true);
  });

  it("a project manager sees only their own projects; money lists are for finance only", async () => {
    await loginAs("pm2@dsc.demo");
    const pm2 = await db.user.findFirstOrThrow({ where: { email: "pm2@dsc.demo" } });
    const rep = await exceptionReport((await getCtx())!);
    const mine = await db.project.findMany({ where: { OR: [{ projectManagerId: pm2.id }, { designerId: pm2.id }, { siteEngineerId: pm2.id }, { supervisorId: pm2.id }, { members: { some: { userId: pm2.id } } }] }, select: { id: true } });
    const allowed = new Set(mine.map((p) => p.id));
    for (const s of rep.sections.filter((s) => ["no_owner", "no_budget", "no_schedule", "no_update", "past_end", "moved_end"].includes(s.key))) for (const row of s.rows) expect(allowed.has(row.id), `${s.key}: ${row.title}`).toBe(true);
    expect(rep.sections.some((s) => s.key === "receivables" || s.key === "bills")).toBe(false);
  });
});

describe("the left menu is split into small sections", () => {
  it("every section has between 2 and 6 items, and every page is still reachable", () => {
    const sections = NAV.filter((g) => g.items.length > 0);
    expect(sections.length).toBeGreaterThanOrEqual(12);
    for (const g of sections) {
      expect(g.items.length, g.label).toBeGreaterThanOrEqual(2);
      expect(g.items.length, g.label).toBeLessThanOrEqual(6);
    }
    const hrefs = NAV.flatMap((g) => [g.href, ...g.items.map((i) => i.href)]);
    for (const h of ["/projects", "/site-reports", "/sales/boq", "/sales/quotations", "/procurement/orders", "/inventory/stock", "/finance/invoices", "/hr/payroll", "/director-reports", "/actions", "/exceptions", "/kpis", "/crm/clients", "/workforce/attendance", "/resources", "/inventory/waste", "/bills-to-certify", "/documents"]) expect(hrefs).toContain(h);
    expect(new Set(hrefs.filter(Boolean)).size).toBe(hrefs.filter(Boolean).length); // no page is listed twice
  });
});
