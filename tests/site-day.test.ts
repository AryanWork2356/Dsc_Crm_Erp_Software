import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { reportDay, dueMinutes, minutesLate, isOnTime } from "@/lib/site-reports";
import { runReportReminders } from "@/lib/site-report-reminders";
import { submitSiteReport, setLateWork, clearLateWork } from "@/app/(app)/site-reports/actions";
import { importSchedule, startTaskToday, updateTask, deleteTask } from "@/app/(app)/projects/actions";
import { weightedProgress } from "@/lib/project-progress";
import { sendMorningPlans } from "@/lib/morning-plan";
import { siteDay } from "@/lib/site-day";
import { notifyUsers } from "@/lib/notify";
import { convertQuotationToProject, createQuotationFromBoq, recordOutsideQuotation, setQuotationStatus } from "@/app/(app)/sales/quotations/actions";
import { createPurchaseRequest } from "@/app/(app)/procurement/actions";

beforeEach(() => logout());
const DAY = 86400000;
const today = reportDay(new Date());
const inDays = (n: number) => new Date(today.getTime() + n * DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const jpeg = (name = "site.jpg") => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])], name, { type: "image/jpeg" });
const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], "quote.pdf", { type: "application/pdf" });

async function newProject(extra: Record<string, unknown> = {}) {
  const company = await db.company.findFirstOrThrow();
  const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
  const [pm, sup] = await Promise.all([db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } }), db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } })]);
  return db.project.create({ data: { companyId: company.id, code: `PRJ-SD${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`, name: "Site day test", clientId: client.id, status: "EXECUTION", startDate: today, projectManagerId: pm.id, supervisorId: sup.id, ...extra } });
}
async function scheduleFile(rows: (string | number)[][], header = ["Sl No", "Task", "Trade", "People needed", "Assigned to", "Start day", "End day"]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Schedule");
  ws.addRow(header); rows.forEach((r) => ws.addRow(r));
  const x = fd({}); x.set("file", new File([new Uint8Array(Buffer.from(await wb.xlsx.writeBuffer()))], "s.xlsx")); return x;
}

describe("the schedule plans the crew once", () => {
  it("each task with a trade and people becomes a crew need that follows the task, and goes with it", async () => {
    await loginAs("director@dsc.demo");
    const p = await newProject();
    expect((await importSchedule(p.id, await scheduleFile([[1, "Carcass", "Carpenter", 6, "", 1, 5], [2, "Wiring", "Electrician", 2, "", 2, 3], [3, "Cleaning", "", "", "", 6, 6]]))).ok).toBe(true);
    const needs = await db.resourceNeed.findMany({ where: { projectId: p.id }, orderBy: { trade: "asc" } });
    expect(needs.map((n) => [n.trade, n.required, iso(n.fromDate), iso(n.toDate)])).toEqual([["Carpenter", 6, iso(today), iso(inDays(4))], ["Electrician", 2, iso(inDays(1)), iso(inDays(2))]]);
    const carcass = await db.projectTask.findFirstOrThrow({ where: { projectId: p.id, name: "Carcass" } });
    expect(needs[0].taskId).toBe(carcass.id);
    // the task changes: the need follows (people and dates), confirmations are kept
    await db.resourceNeed.update({ where: { id: needs[0].id }, data: { confirmed: 6, confirmedNote: "Sai, by phone" } });
    expect((await updateTask(carcass.id, fd({ name: "Carcass", requiredTrade: "Carpenter", requiredHeadcount: 8, startDate: iso(inDays(1)), dueDate: iso(inDays(4)), priority: "MEDIUM" }))).ok).toBe(true);
    const moved = await db.resourceNeed.findUniqueOrThrow({ where: { id: needs[0].id } });
    expect([moved.required, iso(moved.fromDate), moved.confirmed]).toEqual([8, iso(inDays(1)), 6]);
    expect((await deleteTask(carcass.id)).ok).toBe(true);
    expect(await db.resourceNeed.count({ where: { id: needs[0].id } })).toBe(0);
  });

  it("Assigned to must be someone with a login; then the job is theirs", async () => {
    await loginAs("director@dsc.demo");
    const p = await newProject();
    const bad = await importSchedule(p.id, await scheduleFile([[1, "Carcass", "Carpenter", 6, "Nobody Such", 1, 5]]));
    expect(bad.ok === false && bad.error).toMatch(/row 2: nobody called “Nobody Such”/);
    expect(await db.projectTask.count({ where: { projectId: p.id } })).toBe(0);
    expect((await importSchedule(p.id, await scheduleFile([[1, "Carcass", "Carpenter", 6, "supervisor@dsc.demo", 1, 5]]))).ok).toBe(true);
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    expect((await db.projectTask.findFirstOrThrow({ where: { projectId: p.id } })).assignedToId).toBe(sup.id);
  });

  it("tomorrow's work can start today: start moves, finish stays, and it waits for the job before it", async () => {
    await loginAs("director@dsc.demo");
    const p = await newProject();
    await importSchedule(p.id, await scheduleFile([[1, "Wiring", "Electrician", 2, "", 1, 1], [2, "Ceiling", "", "", "", 2, 4]], ["Sl No", "Task", "Trade", "People needed", "Assigned to", "Start day", "End day"]));
    const [wiring, ceiling] = await db.projectTask.findMany({ where: { projectId: p.id }, orderBy: { code: "asc" } });
    await loginAs("supervisor@dsc.demo");
    const r = await startTaskToday(ceiling.id);
    expect(r.ok).toBe(true);
    const c = await db.projectTask.findUniqueOrThrow({ where: { id: ceiling.id } });
    expect([iso(c.startDate!), iso(c.dueDate!), c.status]).toEqual([iso(today), iso(inDays(3)), "IN_PROGRESS"]);
    // a job that depends on an unfinished one cannot jump ahead
    await db.projectTask.update({ where: { id: ceiling.id }, data: { dependsOnId: wiring.id, status: "TODO", startDate: inDays(1) } });
    expect((await startTaskToday(ceiling.id)).ok).toBe(false);
  });
});

describe("the morning update and evening report", () => {
  it("morning: who came per trade fills the Manpower record; fewer than planned needs a reason and raises one action", async () => {
    await loginAs("director@dsc.demo");
    const p = await newProject();
    await importSchedule(p.id, await scheduleFile([[1, "Carcass", "Carpenter", 6, "", 1, 5], [2, "Wiring", "Electrician", 2, "", 1, 1]]));
    const day = await siteDay(p.companyId, p.id);
    expect(day.crew).toEqual([{ trade: "Carpenter", planned: 6, present: null }, { trade: "Electrician", planned: 2, present: null }]);
    expect(day.todayTasks.map((t) => t.name)).toEqual(["Carcass", "Wiring"]);
    await loginAs("supervisor@dsc.demo");
    const form = (crew: unknown, reason = "") => { const x = fd({ projectId: p.id, kind: "MORNING", manpower: 7, planNext: "Carcass; Wiring", crew: JSON.stringify(crew), crewReason: reason }); x.set("selfie", jpeg("me.jpg")); x.append("photos", jpeg()); return x; };
    const short = [{ trade: "Carpenter", planned: 6, present: 5 }, { trade: "Electrician", planned: 2, present: 2 }];
    const noWhy = await submitSiteReport(form(short));
    expect(noWhy.ok === false && noWhy.error).toMatch(/write why/);
    expect((await submitSiteReport(form(short, "One carpenter ill"))).ok).toBe(true);
    const logs = await db.manpowerLog.findMany({ where: { projectId: p.id, date: today }, orderBy: { trade: "asc" } });
    expect(logs.map((l) => [l.trade, l.planned, l.present, l.reason])).toEqual([["Carpenter", 6, 5, "One carpenter ill"], ["Electrician", 2, 2, null]]);
    expect(await db.actionItem.count({ where: { sourceType: "ManpowerLog", sourceId: logs[0].id, status: { in: ["OPEN", "IN_PROGRESS"] } } })).toBe(1);
  });

  it("evening: pressing how far each job got updates the schedule and the project progress; no typing needed", async () => {
    await loginAs("director@dsc.demo");
    const p = await newProject();
    await importSchedule(p.id, await scheduleFile([[1, "Carcass", "Carpenter", 6, "", 1, 3], [2, "Wiring", "Electrician", 2, "", 1, 1]]));
    const [carcass, wiring] = await db.projectTask.findMany({ where: { projectId: p.id }, orderBy: { code: "asc" } });
    await loginAs("supervisor@dsc.demo");
    const x = fd({ projectId: p.id, kind: "EVENING", manpower: 8, tasks: JSON.stringify([{ id: carcass.id, progress: 50 }, { id: wiring.id, progress: 100 }]) });
    expect((await submitSiteReport(x)).ok).toBe(false); // no photo
    x.append("photos", jpeg());
    expect((await submitSiteReport(x)).ok).toBe(true);
    const [c2, w2] = await db.projectTask.findMany({ where: { projectId: p.id }, orderBy: { code: "asc" } });
    expect([c2.progress, c2.status, w2.progress, w2.status]).toEqual([50, "IN_PROGRESS", 100, "COMPLETED"]);
    const proj = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(proj.progress).toBe(63); // 3 days at 50 % and 1 day at 100 %: (150 + 100) / 4
    const rep = await db.dailyReport.findFirstOrThrow({ where: { projectId: p.id, kind: "EVENING", reportDate: today } });
    expect(rep.workDone).toMatch(/Carcass: 50%; Wiring: finished/);
    expect(rep.progressPct).toBe(63);
  });

  it("the worker list is the attendance: name, work, coming and going time; it counts the crew per trade and keeps a voice note", async () => {
    await loginAs("director@dsc.demo");
    const p = await newProject();
    await importSchedule(p.id, await scheduleFile([[1, "Carcass", "Carpenter", 3, "", 1, 5], [2, "Wiring", "Electrician", 1, "", 1, 1]]));
    const [carcass, wiring] = await db.projectTask.findMany({ where: { projectId: p.id }, orderBy: { code: "asc" } });
    await loginAs("supervisor@dsc.demo");
    const workers = [
      { name: "Ramesh", taskId: carcass.id, inTime: "09:05" }, { name: "Suresh", taskId: carcass.id, inTime: "09:10" },
      { name: "Imran", taskId: wiring.id, inTime: "09:30" }, { name: "Babu", work: "Cleaning", inTime: "10:00" },
    ];
    const m = fd({ projectId: p.id, kind: "MORNING", manpower: 0, planNext: "Carcass; Wiring", workers: JSON.stringify(workers) });
    m.set("selfie", jpeg("me.jpg")); m.append("photos", jpeg());
    const noWhy = await submitSiteReport(m);
    expect(noWhy.ok === false && noWhy.error).toMatch(/Carpenter: 2 of 3/); // one carpenter short: say why
    m.set("crewReason", "One carpenter on leave");
    const voice = new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0])], "voice.m4a", { type: "audio/mp4" });
    m.set("voice", voice);
    expect((await submitSiteReport(m)).ok).toBe(true);
    const rep = await db.dailyReport.findFirstOrThrow({ where: { projectId: p.id, kind: "MORNING", reportDate: today } });
    expect(rep.manpower).toBe(4);
    const docs = await db.document.findMany({ where: { id: { in: rep.photoIds } } });
    expect(docs.map((d) => d.mimeType).sort()).toEqual(["audio/mp4", "image/jpeg", "image/jpeg"]);
    const att = await db.siteLabour.findMany({ where: { projectId: p.id, date: today }, orderBy: { name: "asc" } });
    expect(att.map((a) => [a.name, a.work, a.inTime])).toEqual([["Babu", "Cleaning", "10:00"], ["Imran", "Wiring", "09:30"], ["Ramesh", "Carcass", "09:05"], ["Suresh", "Carcass", "09:10"]]);
    const logs = await db.manpowerLog.findMany({ where: { projectId: p.id, date: today }, orderBy: { trade: "asc" } });
    expect(logs.map((l) => [l.trade, l.planned, l.present])).toEqual([["Carpenter", 3, 2], ["Electrician", 1, 1]]);
    // the evening report puts the going time; the same name twice is refused
    const twice = fd({ projectId: p.id, kind: "EVENING", manpower: 0, workDone: "x", workers: JSON.stringify([{ name: "Ramesh", outTime: "18:00" }, { name: "ramesh", outTime: "18:00" }]) }); twice.append("photos", jpeg());
    expect((await submitSiteReport(twice)).ok).toBe(false);
    const e = fd({ projectId: p.id, kind: "EVENING", manpower: 0, workDone: "Carcass half", workers: JSON.stringify(att.map((a) => ({ name: a.name, taskId: a.taskId, work: a.work, inTime: a.inTime, outTime: "18:30" }))) }); e.append("photos", jpeg());
    expect((await submitSiteReport(e)).ok).toBe(true);
    expect((await db.siteLabour.findMany({ where: { projectId: p.id, date: today } })).every((a) => a.outTime === "18:30" && a.inTime)).toBe(true);
  });

  it("progress weighs each job by its days", () => {
    expect(weightedProgress([{ progress: 100, startDate: today, dueDate: today }, { progress: 0, startDate: today, dueDate: inDays(9) }])).toBe(9);
    expect(weightedProgress([])).toBeNull();
  });
});

describe("working late", () => {
  it("moves the evening deadline to an hour after the given time, and nobody is chased before it", async () => {
    expect(dueMinutes("EVENING", false, undefined, "22:00")).toBe(23 * 60);
    expect(dueMinutes("EVENING", false, undefined, "17:00")).toBe(19 * 60); // never earlier than normal
    expect(dueMinutes("EVENING", false, undefined, "23:30")).toBe(23 * 60 + 59);
    const at2130 = new Date(Date.parse(`${iso(today)}T21:30:00+05:30`));
    expect(minutesLate("EVENING", false, at2130, undefined, "22:00")).toBe(0);
    expect(isOnTime("EVENING", false, today, at2130, undefined, "22:00")).toBe(true);

    const p = await newProject();
    await loginAs("supervisor@dsc.demo");
    const early = await setLateWork(p.id, fd({ until: "18:00" }));
    expect(early.ok === false && early.error).toMatch(/not late/);
    expect((await setLateWork(p.id, fd({ until: "22:00", reason: "Kitchen before client visit" }))).ok).toBe(true);
    await db.notification.deleteMany({ where: { dedupeKey: { startsWith: `rep:${p.id}:` } } });
    await runReportReminders(p.companyId, at2130);
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `rep:${p.id}:${iso(today)}:EVENING` } } })).toBe(0);
    await runReportReminders(p.companyId, new Date(Date.parse(`${iso(today)}T23:20:00+05:30`)));
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `rep:${p.id}:${iso(today)}:EVENING` } } })).toBeGreaterThan(0);
    expect((await clearLateWork(p.id)).ok).toBe(true);
    expect(await db.lateWork.count({ where: { projectId: p.id } })).toBe(0);
  });
});

describe("the morning message", () => {
  it("sends each site's work of the day once, from 6:30, to the supervisor and the project manager", async () => {
    await loginAs("director@dsc.demo");
    const p = await newProject();
    await importSchedule(p.id, await scheduleFile([[1, "Carcass", "Carpenter", 6, "", 1, 5]]));
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    const key = `plan:${p.id}:${iso(today)}`;
    await sendMorningPlans(p.companyId, new Date(Date.parse(`${iso(today)}T06:00:00+05:30`)));
    expect(await db.notification.count({ where: { dedupeKey: key } })).toBe(0); // too early
    await sendMorningPlans(p.companyId, new Date(Date.parse(`${iso(today)}T07:00:00+05:30`)));
    await sendMorningPlans(p.companyId, new Date(Date.parse(`${iso(today)}T07:05:00+05:30`)));
    const sent = await db.notification.findMany({ where: { dedupeKey: key } });
    expect(sent.map((n) => n.userId)).toEqual(expect.arrayContaining([sup.id, p.projectManagerId]));
    expect(sent).toHaveLength(2);
    expect(sent[0].title).toMatch(/Today at .*: 1 job/);
    expect(sent[0].body).toMatch(/Carcass[\s\S]*Crew: 6 Carpenter/);
  });

  it("a repeated alert is not created twice", async () => {
    const u = await db.user.findFirstOrThrow({ where: { email: "store@dsc.demo" } });
    const key = `test-once:${Date.now()}`;
    await notifyUsers([u.id], { companyId: u.companyId, type: "GENERAL", title: "Once", dedupeKey: key });
    await notifyUsers([u.id], { companyId: u.companyId, type: "GENERAL", title: "Once", dedupeKey: key });
    expect(await db.notification.count({ where: { dedupeKey: key } })).toBe(1);
  });
});

describe("quotations", () => {
  it("one made outside the app: recorded with its file, accepted, converted; the file goes to the project", async () => {
    await loginAs("owner@dsc.demo");
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const x = fd({ clientId: client.id, title: "3 BHK Thane", date: iso(today), amount: "1000000", taxPercent: "18", accepted: "on" }); x.set("file", pdf());
    const r = await recordOutsideQuotation(x);
    expect(r.ok).toBe(true);
    const q = await db.quotation.findUniqueOrThrow({ where: { id: (r as { data: { id: string } }).data.id } });
    expect([q.status, Number(q.subtotal), Number(q.total)]).toEqual(["ACCEPTED", 1000000, 1180000]);
    expect(await db.document.count({ where: { entityType: "QUOTATION", entityId: q.id } })).toBe(1);
    const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
    const conv = await convertQuotationToProject(q.id, fd({ projectManagerId: pm.id, startDate: iso(today) }));
    expect(conv.ok).toBe(true);
    const projectId = (conv as { data: { projectId: string } }).data.projectId;
    expect(Number((await db.project.findUniqueOrThrow({ where: { id: projectId } })).contractValue)).toBe(1000000);
    expect(await db.document.count({ where: { entityType: "PROJECT", entityId: projectId } })).toBe(1);
    // the same number twice is refused
    const again = await recordOutsideQuotation(fd({ clientId: client.id, number: q.number, date: iso(today), amount: "5" }));
    expect(again.ok === false && again.error).toMatch(/already in the app/);
  });

  it("converting a quotation made from a priced BOQ keeps THAT BOQ, with its costs, and sets the budget", async () => {
    await loginAs("owner@dsc.demo");
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const boq = await db.boq.create({ data: { companyId: company.id, number: `BOQ-SD${Date.now().toString(36)}`, title: "Priced", status: "APPROVED", items: { create: [{ sortOrder: 0, item: "Wardrobe", unit: "sqft", quantity: 100, sellingRate: 1500, estimatedCost: 110000, total: 150000 }] } } });
    const q = await createQuotationFromBoq(boq.id, fd({ clientId: client.id }));
    const qid = (q as { data: { id: string } }).data.id;
    await db.quotation.update({ where: { id: qid }, data: { status: "SENT" } });
    expect((await setQuotationStatus(qid, "ACCEPTED")).ok).toBe(true);
    const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
    const before = await db.boq.count();
    const conv = await convertQuotationToProject(qid, fd({ projectManagerId: pm.id }));
    expect(conv.ok).toBe(true);
    const projectId = (conv as { data: { projectId: string; boqId: string } }).data.projectId;
    expect((conv as { data: { boqId: string } }).data.boqId).toBe(boq.id);
    expect(await db.boq.count()).toBe(before); // no second BOQ
    expect(Number((await db.project.findUniqueOrThrow({ where: { id: projectId } })).budget)).toBe(110000);
  });
});

describe("purchase requests", () => {
  it("Send for approval saves and sends in one press; Save as draft only saves", async () => {
    await loginAs("supervisor@dsc.demo");
    const p = await newProject();
    const items = JSON.stringify([{ description: "Tile adhesive", unit: "bags", quantity: 10 }]);
    const base = { projectId: p.id, requiredDate: iso(inDays(7)), priority: "MEDIUM", items, reason: "For tiling" };
    const sent = await createPurchaseRequest(fd({ ...base, submitNow: "1" }));
    expect(sent.ok && sent.message).toMatch(/sent for approval/);
    const draft = await createPurchaseRequest(fd(base));
    expect(draft.ok && draft.message).toMatch(/draft/);
    const rows = await db.purchaseRequest.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["PENDING_APPROVAL", "DRAFT"]);
  });
});
