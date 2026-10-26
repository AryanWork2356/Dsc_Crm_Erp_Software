import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { calendarDay } from "@/lib/utils";
import { saveResourceNeed, deleteResourceNeed, logManpower, setResourceCoordinator } from "@/app/(app)/resources/actions";
import { resourceBoard, syncResourceShortages, vendorScores, shortDaySeverity } from "@/lib/resources";
import { createTask, setTaskStatus, updateTask } from "@/app/(app)/projects/actions";
import { taskHealth } from "@/lib/task-health";
import { decideFeasibility, updateChecklistItem } from "@/app/(app)/feasibility/actions";
import { feasibilityForProject, feasibilityForQuotation, launchDue, OUTSTATION_EXTRA_DAYS } from "@/lib/readiness";
import { getTimeLimitItems } from "@/lib/time-limits";
import { createVendor, updateVendor } from "@/app/(app)/procurement/actions";

beforeEach(() => logout());

const DAY = 86400000;
const iso = (days: number) => new Date(calendarDay().getTime() + days * DAY).toISOString().slice(0, 10);

async function liveProject() {
  const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
  const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
  const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
  const p = await db.project.create({ data: { companyId: client.companyId, code: `PRJ-T${Math.floor(Math.random() * 1e6)}`, name: "Planning test site", clientId: client.id, status: "EXECUTION", projectManagerId: pm.id, supervisorId: sup.id, members: { create: [{ userId: pm.id, roleLabel: "Project Manager" }, { userId: sup.id, roleLabel: "Supervisor" }] } } });
  return { p, pm, sup };
}

describe("manpower: need, confirmed, present", () => {
  let projectId = "";
  let pmId = "";
  let supId = "";
  let needId = "";
  let vendorId = "";
  let vendor2 = "";

  it("a vendor can be a first-choice, backup or emergency labour vendor with trades and crew size", async () => {
    const { p, pm, sup } = await liveProject();
    projectId = p.id; pmId = pm.id; supId = sup.id;
    await loginAs("procurement@dsc.demo");
    const a = await createVendor(fd({ name: "Shree Carpenters", trades: "Carpenter", tier: "PRIMARY", crewSize: "6" }));
    const b = await createVendor(fd({ name: "Backup Woodworks", trades: "Carpenter", tier: "BACKUP" }));
    expect(a.ok && b.ok).toBe(true);
    vendorId = (a as unknown as { data: { id: string } }).data.id;
    vendor2 = (b as unknown as { data: { id: string } }).data.id;
    expect(await db.vendor.findUniqueOrThrow({ where: { id: vendorId } })).toMatchObject({ tier: "PRIMARY", trades: "Carpenter", crewSize: 6 });
    expect(await db.vendor.findUniqueOrThrow({ where: { id: vendor2 } })).toMatchObject({ tier: "BACKUP" });
    expect((await updateVendor(vendorId, fd({ name: "Shree Carpenters", trades: "Carpenter, Polisher", crewSize: "0" }))).ok).toBe(false); // crew size 0 is not a crew
  });

  it("only people who plan resources can add a need; supervisors can only record who came", async () => {
    await loginAs("supervisor@dsc.demo");
    expect((await saveResourceNeed(null, fd({ projectId, trade: "Carpenter", fromDate: iso(1), toDate: iso(5), required: 8 }))).ok).toBe(false);
    await loginAs("pm@dsc.demo");
    const r = await saveResourceNeed(null, fd({ projectId, trade: "Carpenter", fromDate: iso(1), toDate: iso(5), required: 8, vendorId, backupVendorId: vendor2 }));
    expect(r.ok).toBe(true);
    needId = (await db.resourceNeed.findFirstOrThrow({ where: { projectId, trade: "Carpenter" } })).id;
    // bad input
    expect((await saveResourceNeed(null, fd({ projectId, trade: "Carpenter", fromDate: iso(5), toDate: iso(1), required: 2 }))).ok).toBe(false);
    expect((await saveResourceNeed(null, fd({ projectId, trade: "Carpenter", fromDate: iso(1), toDate: iso(5), required: 2, vendorId, backupVendorId: vendorId }))).ok).toBe(false);
    expect((await saveResourceNeed(null, fd({ projectId, trade: "", fromDate: iso(1), toDate: iso(5), required: 2 }))).ok).toBe(false);
  });

  it("a need that is short and starts soon raises exactly one action for the PM, and closes itself when covered", async () => {
    const company = await db.company.findFirstOrThrow();
    await syncResourceShortages(company.id);
    await syncResourceShortages(company.id);
    const open = await db.actionItem.findMany({ where: { sourceType: "ResourceNeed", sourceId: needId } });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: "OPEN", ownerId: pmId, projectId });
    expect(open[0].title).toMatch(/8 carpenters still not confirmed/);

    await loginAs("pm@dsc.demo");
    // confirming people needs to say who confirmed them
    expect((await saveResourceNeed(needId, fd({ projectId, trade: "Carpenter", fromDate: iso(1), toDate: iso(5), required: 8, confirmed: 8, vendorId }))).ok).toBe(false);
    expect((await saveResourceNeed(needId, fd({ projectId, trade: "Carpenter", fromDate: iso(1), toDate: iso(5), required: 8, confirmed: 8, vendorId, confirmedNote: "Ramesh (Shree) by phone, today 4 pm" }))).ok).toBe(true);
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: open[0].id } })).status).toBe("RESOLVED");
  });

  it("the board compares needed, confirmed and actual, and flags a vendor promised beyond its crew", async () => {
    const today = calendarDay();
    const rows = await resourceBoard((await db.company.findFirstOrThrow()).id, [projectId], today, new Date(today.getTime() + 14 * DAY), today);
    const row = rows.find((r) => r.id === needId)!;
    expect(row).toMatchObject({ required: 8, confirmed: 8, gap: 0 });
    expect(row.status).toBe("OVERCOMMITTED"); // Shree Carpenters can field 6 but 8 are confirmed on it
    await loginAs("pm@dsc.demo");
    await saveResourceNeed(needId, fd({ projectId, trade: "Carpenter", fromDate: iso(1), toDate: iso(5), required: 6, confirmed: 6, vendorId, confirmedNote: "Ramesh by phone" }));
    const rows2 = await resourceBoard((await db.company.findFirstOrThrow()).id, [projectId], today, new Date(today.getTime() + 14 * DAY), today);
    expect(rows2.find((r) => r.id === needId)!.status).toBe("COVERED");
  });

  it("the supervisor records who came; fewer than planned needs a reason and raises one action; a full day closes it", async () => {
    await loginAs("supervisor@dsc.demo");
    const today = iso(0);
    expect((await logManpower(fd({ projectId, date: today, trade: "Carpenter", planned: 6, present: 3 }))).ok).toBe(false); // why?
    expect((await logManpower(fd({ projectId, date: today, trade: "Carpenter", planned: 6, present: 7 }))).ok).toBe(true); // more than planned is fine
    expect((await logManpower(fd({ projectId, date: today, trade: "Carpenter", planned: 6, present: 3, late: 4, reason: "x" }))).ok).toBe(false); // late > came
    expect((await logManpower(fd({ projectId, date: iso(1), trade: "Carpenter", planned: 6, present: 6 }))).ok).toBe(false); // the future
    expect((await logManpower(fd({ projectId, date: today, trade: "Carpenter", planned: 6, present: 3, late: 1, vendorId, reason: "Vendor sent only half", replacement: "Called the backup" }))).ok).toBe(true);
    const log = await db.manpowerLog.findFirstOrThrow({ where: { projectId, trade: "Carpenter", date: calendarDay() } });
    const acts = await db.actionItem.findMany({ where: { sourceType: "ManpowerLog", sourceId: log.id } });
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ status: "OPEN", severity: "HIGH", ownerId: pmId, createdById: supId });
    // recording the same day again does not duplicate the action
    await logManpower(fd({ projectId, date: today, trade: "Carpenter", planned: 6, present: 4, vendorId, reason: "One more arrived" }));
    expect(await db.actionItem.count({ where: { sourceType: "ManpowerLog", sourceId: log.id } })).toBe(1);
    // corrected to a full crew: the action closes
    await logManpower(fd({ projectId, date: today, trade: "Carpenter", planned: 6, present: 6, vendorId }));
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: acts[0].id } })).status).toBe("RESOLVED");
  });

  it("reliability comes from the records, and shows only after enough days", async () => {
    const company = await db.company.findFirstOrThrow();
    for (let k = 1; k <= 6; k++) {
      await db.manpowerLog.upsert({ where: { projectId_date_trade: { projectId, date: new Date(calendarDay().getTime() - k * DAY), trade: "Carpenter" } }, create: { companyId: company.id, projectId, date: new Date(calendarDay().getTime() - k * DAY), trade: "Carpenter", planned: 10, present: 8, late: 2, vendorId: vendor2, recordedById: supId }, update: {} });
    }
    const s = (await vendorScores(company.id, [vendor2, vendorId])).get(vendor2)!;
    expect(s).toMatchObject({ days: 6, planned: 60, present: 48, late: 12, enough: true, attendancePct: 80, punctualityPct: 75 });
    expect((await vendorScores(company.id, [vendorId])).get(vendorId)?.enough).toBe(false); // only a day or two recorded
    expect(shortDaySeverity(8, 0)).toBe("CRITICAL");
    expect(shortDaySeverity(8, 4)).toBe("HIGH");
    expect(shortDaySeverity(8, 6)).toBe("MEDIUM");
  });

  it("removing a need closes its action; only the right people name the coordinator", async () => {
    await loginAs("pm@dsc.demo");
    const r = await saveResourceNeed(null, fd({ projectId, trade: "Electrician", fromDate: iso(0), toDate: iso(3), required: 3 }));
    expect(r.ok).toBe(true);
    const n = await db.resourceNeed.findFirstOrThrow({ where: { projectId, trade: "Electrician" } });
    expect(await db.actionItem.count({ where: { sourceType: "ResourceNeed", sourceId: n.id, status: "OPEN" } })).toBe(1);
    expect((await deleteResourceNeed(n.id)).ok).toBe(true);
    expect(await db.actionItem.count({ where: { sourceType: "ResourceNeed", sourceId: n.id, status: "OPEN" } })).toBe(0);
    expect((await setResourceCoordinator(fd({ userId: pmId }))).ok).toBe(false); // a project manager does not change company settings
    await loginAs("owner@dsc.demo");
    expect((await setResourceCoordinator(fd({ userId: supId }))).ok).toBe(true);
    const company = await db.company.findFirstOrThrow();
    const m = await saveResourceNeed(null, fd({ projectId, trade: "Painter", fromDate: iso(0), toDate: iso(2), required: 2 })); // owner may plan too
    expect(m.ok).toBe(true);
    await syncResourceShortages(company.id);
    const paint = await db.resourceNeed.findFirstOrThrow({ where: { projectId, trade: "Painter" } });
    expect((await db.actionItem.findFirstOrThrow({ where: { sourceType: "ResourceNeed", sourceId: paint.id } })).ownerId).toBe(supId); // the named coordinator is told first
    await setResourceCoordinator(fd({}));
  });
});

describe("tasks: zone, quantity, trade and an honest status", () => {
  it("health follows written rules", () => {
    const today = new Date("2026-11-10T00:00:00Z");
    const d = (n: number) => new Date(today.getTime() + n * DAY);
    expect(taskHealth({ status: "COMPLETED", dueDate: d(-3), startDate: null, progress: 100 }, today)).toBe("COMPLETE");
    expect(taskHealth({ status: "BLOCKED", dueDate: d(5), startDate: null, progress: 10 }, today)).toBe("BLOCKED");
    expect(taskHealth({ status: "IN_PROGRESS", dueDate: d(-1), startDate: null, progress: 50 }, today)).toBe("DELAYED");
    expect(taskHealth({ status: "IN_PROGRESS", dueDate: d(2), startDate: null, progress: 40 }, today)).toBe("AT_RISK");
    expect(taskHealth({ status: "IN_PROGRESS", dueDate: d(2), startDate: null, progress: 90 }, today)).toBe("ON_TRACK");
    expect(taskHealth({ status: "TODO", dueDate: d(9), startDate: d(-1), progress: 0 }, today)).toBe("AT_RISK"); // should have started
    expect(taskHealth({ status: "TODO", dueDate: d(20), startDate: d(5), progress: 0, dependsOn: { status: "IN_PROGRESS", dueDate: d(8) } }, today)).toBe("AT_RISK"); // waits for something that ends after it should start
    expect(taskHealth({ status: "TODO", dueDate: d(20), startDate: d(5), progress: 0, dependsOn: { status: "IN_PROGRESS", dueDate: d(3) } }, today)).toBe("ON_TRACK");
  });

  it("zone, planned and actual quantity and the trade are kept; blocking a task raises one action and unblocking closes it", async () => {
    const { p, pm } = await liveProject();
    await loginAs("pm@dsc.demo");
    const r = await createTask(p.id, fd({ name: "Install cabinets", zone: "Zone B", plannedQty: 12, qtyUnit: "nos", requiredTrade: "Carpenter", requiredHeadcount: 4, dueDate: iso(5) }));
    expect(r.ok).toBe(true);
    const t = await db.projectTask.findFirstOrThrow({ where: { projectId: p.id, name: "Install cabinets" } });
    expect(t).toMatchObject({ zone: "Zone B", qtyUnit: "nos", requiredTrade: "Carpenter", requiredHeadcount: 4, zoneReleased: false });
    expect(Number(t.plannedQty)).toBe(12);
    expect((await updateTask(t.id, fd({ name: "Install cabinets", zone: "Zone B", plannedQty: 12, actualQty: 12, qtyUnit: "nos", zoneReleased: "on", dueDate: iso(5) }))).ok).toBe(true);
    const done = await db.projectTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(Number(done.actualQty)).toBe(12);
    expect(done.zoneReleased).toBe(true);
    expect(done.releasedAt).not.toBeNull();

    expect((await setTaskStatus(t.id, "BLOCKED")).ok).toBe(true);
    const acts = await db.actionItem.findMany({ where: { sourceType: "ProjectTask", sourceId: t.id } });
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ status: "OPEN", ownerId: pm.id, severity: "HIGH" });
    expect((await setTaskStatus(t.id, "IN_PROGRESS")).ok).toBe(true);
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: acts[0].id } })).status).toBe("RESOLVED");
  });
});

describe("feasibility check and launch checklist", () => {
  it("a quotation gets the eight questions; a project carries them over and adds the launch steps with dates", async () => {
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const quote = await db.quotation.create({ data: { companyId: company.id, number: `QT-FEAS${Math.floor(Math.random() * 1e6)}`, clientId: client.id, title: "Feasibility test" } });
    const f = await feasibilityForQuotation(company.id, quote.id);
    expect(f.items.filter((i) => i.kind === "FEASIBILITY").map((i) => i.key)).toEqual(["scope", "commercial", "manpower", "vendors", "materials", "factory", "schedule", "risk"]);
    expect((await feasibilityForQuotation(company.id, quote.id)).items).toHaveLength(8); // opening it again adds nothing

    const { p } = await liveProject();
    await db.project.update({ where: { id: p.id }, data: { quotationId: quote.id, outstation: true } });
    const pf = await feasibilityForProject(company.id, p.id);
    expect(pf.id).toBe(f.id); // the same record moved to the project
    const launch = pf.items.filter((i) => i.kind === "LAUNCH");
    expect(launch).toHaveLength(11);
    const day0 = launch.find((i) => i.key === "d0_handover")!.dueDate!;
    const day1 = launch.find((i) => i.key === "d1_tasks")!.dueDate!;
    expect(Math.round((day1.getTime() - day0.getTime()) / DAY)).toBe(1 + OUTSTATION_EXTRA_DAYS); // out-of-city jobs get extra days after Day 0
    expect(launchDue(new Date("2026-11-01T00:00:00Z"), 2, false).toISOString().slice(0, 10)).toBe("2026-11-03");
  });

  it("confirming needs a note; only directors decide; accepting with open questions is a recorded exception with a date and an action per gap", async () => {
    const company = await db.company.findFirstOrThrow();
    const { p, pm } = await liveProject();
    const f = await feasibilityForProject(company.id, p.id);
    const manpower = f.items.find((i) => i.kind === "FEASIBILITY" && i.key === "manpower")!;
    await loginAs("pm@dsc.demo");
    expect((await updateChecklistItem(manpower.id, fd({ status: "CONFIRMED" }))).ok).toBe(false); // a name in a box is not a confirmation
    expect((await updateChecklistItem(manpower.id, fd({ status: "CONFIRMED", evidence: "Ramesh (Shree) confirmed 8 carpenters by phone, 26 Oct" }))).ok).toBe(true);
    expect((await db.checklistItem.findUniqueOrThrow({ where: { id: manpower.id } })).confirmedById).toBe(pm.id);
    expect((await decideFeasibility(f.id, fd({ decision: "ACCEPT" }))).ok).toBe(false); // a project manager cannot decide

    await loginAs("director@dsc.demo");
    const refused = await decideFeasibility(f.id, fd({ decision: "ACCEPT" }));
    expect(refused.ok).toBe(false); // 7 questions are open
    expect((await decideFeasibility(f.id, fd({ decision: "ACCEPT", exceptionNote: "Client needs a start this week; vendors will confirm tomorrow" }))).ok).toBe(false); // no date to close them
    expect((await decideFeasibility(f.id, fd({ decision: "ACCEPT", exceptionNote: "Client needs a start this week; vendors will confirm tomorrow", resolveBy: iso(3) }))).ok).toBe(true);
    const after = await db.feasibility.findUniqueOrThrow({ where: { id: f.id } });
    expect(after).toMatchObject({ decision: "ACCEPT" });
    expect(after.exceptionApproverId).not.toBeNull();
    expect(await db.actionItem.count({ where: { sourceType: "ChecklistItem", sourceId: { in: f.items.map((i) => i.id) }, status: "OPEN" } })).toBe(7);

    expect((await decideFeasibility(f.id, fd({ decision: "RENEGOTIATE_OR_DECLINE" }))).ok).toBe(false); // must say why
    expect((await decideFeasibility(f.id, fd({ decision: "RENEGOTIATE_OR_DECLINE", note: "Cannot staff 10 carpenters in 3 days" }))).ok).toBe(true);
    expect((await db.feasibility.findUniqueOrThrow({ where: { id: f.id } })).exceptionNote).toBeNull(); // declining is not an exception
  });

  it("a launch step that passes its date without confirmation reaches the owner through the time-limit board", async () => {
    const company = await db.company.findFirstOrThrow();
    const { p } = await liveProject();
    const f = await feasibilityForProject(company.id, p.id);
    const step = f.items.find((i) => i.key === "d2_vendors")!;
    await db.checklistItem.update({ where: { id: step.id }, data: { dueDate: new Date(Date.now() - 20 * 3600000) } }); // past its date and past the 12-hour grace
    const hit = (await getTimeLimitItems(company.id)).find((i) => i.ruleKey === "launch_overdue" && i.id === step.id);
    expect(hit?.state).toBe("overdue");
    await db.checklistItem.update({ where: { id: step.id }, data: { status: "CONFIRMED", evidence: "Confirmed by Ramesh" } });
    expect((await getTimeLimitItems(company.id)).some((i) => i.ruleKey === "launch_overdue" && i.id === step.id)).toBe(false);
  });
});
