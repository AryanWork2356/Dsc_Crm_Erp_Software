import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { submitSiteReport } from "@/app/(app)/site-reports/actions";
import { dueLabel, dueMinutes, isOnTime, istParts, minutesLate, reportDay, slotState } from "@/lib/site-reports";
import { runReportReminders } from "@/lib/site-report-reminders";

beforeEach(() => logout());

const proj = (code: string) => db.project.findFirstOrThrow({ where: { code } });
// minimal valid JPEG header (enough for the magic-byte check)
const jpeg = (name = "site.jpg") => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])], name, { type: "image/jpeg" });
/** a moment today (IST) at the given IST clock time */
const todayAt = (h: number, m = 0) => Date.parse(`${istParts().date}T00:00:00+05:30`) + (h * 60 + m) * 60000;

describe("site report timing (IST)", () => {
  it("knows the IST date and clock for a UTC moment", () => {
    // 2026-03-04 20:00 UTC is already 01:30 on 5 March in India
    expect(istParts(new Date("2026-03-04T20:00:00Z"))).toEqual({ date: "2026-03-05", minutes: 90 });
    expect(reportDay(new Date("2026-03-04T20:00:00Z")).toISOString()).toBe("2026-03-05T00:00:00.000Z");
  });

  it("uses 10:00 for city sites, 9:30 for outstation, 19:00 for the evening report", () => {
    expect(dueMinutes("MORNING", false)).toBe(600);
    expect(dueMinutes("MORNING", true)).toBe(570);
    expect(dueMinutes("EVENING", false)).toBe(1140);
    expect(dueLabel("MORNING", true)).toBe("9:30 AM");
    expect(dueLabel("EVENING", false)).toBe("7:00 PM");
  });

  it("honours company-configured times", () => {
    expect(dueMinutes("MORNING", false, { reportMorningDue: "08:15", reportMorningDueOutstation: "07:45", reportEveningDue: "18:00" })).toBe(495);
    expect(dueMinutes("EVENING", false, { reportMorningDue: "x", reportMorningDueOutstation: "y", reportEveningDue: "bad" })).toBe(1140); // bad value falls back
  });

  it("judges on-time against the deadline and the report's own day", () => {
    const day = new Date("2026-03-05T00:00:00.000Z");
    expect(isOnTime("MORNING", false, day, new Date("2026-03-05T04:00:00Z"))).toBe(true); // 09:30 IST
    expect(isOnTime("MORNING", false, day, new Date("2026-03-05T04:31:00Z"))).toBe(false); // 10:01 IST
    expect(isOnTime("MORNING", true, day, new Date("2026-03-05T04:10:00Z"))).toBe(false); // 09:40 IST, outstation deadline 09:30
    expect(isOnTime("MORNING", false, day, new Date("2026-03-06T02:00:00Z"))).toBe(false); // filed the next day
  });

  it("colours today's slot: done / waiting / due soon / overdue", () => {
    const at = (iso: string) => new Date(iso);
    expect(slotState("MORNING", false, true, at("2026-03-05T09:00:00Z"))).toBe("done");
    expect(slotState("MORNING", false, false, at("2026-03-05T02:00:00Z"))).toBe("waiting"); // 07:30 IST
    expect(slotState("MORNING", false, false, at("2026-03-05T04:00:00Z"))).toBe("due_soon"); // 09:30 IST
    expect(slotState("MORNING", false, false, at("2026-03-05T04:45:00Z"))).toBe("overdue"); // 10:15 IST
    expect(minutesLate("MORNING", false, at("2026-03-05T04:45:00Z"))).toBe(15);
    expect(minutesLate("MORNING", false, at("2026-03-05T03:00:00Z"))).toBe(0);
  });
});

describe("missing-report reminders escalate up the chain", () => {
  const count = (where: object) => db.notification.count({ where: { type: "REPORT_MISSING", ...where } });

  it("chases the supervisor at the deadline, the PM an hour later, management after three hours – once each", async () => {
    const p = await proj("PRJ-00001");
    const company = p.companyId;
    // other suites (e.g. the cron endpoint) may already have sent today's reminders at the real clock time
    await db.notification.deleteMany({ where: { type: "REPORT_MISSING" } });
    await db.dailyReport.deleteMany({ where: { projectId: p.id, reportDate: reportDay() } });
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    const pm = await db.user.findFirstOrThrow({ where: { id: p.projectManagerId! } });
    const owner = await db.user.findFirstOrThrow({ where: { email: "owner@dsc.demo" } });
    const dayKey = istParts().date;
    const mine = (userId: string) => count({ userId, dedupeKey: { startsWith: `rep:${p.id}:${dayKey}:MORNING` } });

    // before the deadline: nothing
    await runReportReminders(company, new Date(todayAt(9, 0)));
    expect(await mine(sup.id)).toBe(0);

    // 10:20 – supervisor only (20 minutes late)
    await runReportReminders(company, new Date(todayAt(10, 20)));
    expect(await mine(sup.id)).toBe(1);
    expect(await mine(pm.id)).toBe(0);

    // 11:15 – PM too (75 minutes late); supervisor not nagged twice
    await runReportReminders(company, new Date(todayAt(11, 15)));
    await runReportReminders(company, new Date(todayAt(11, 16)));
    expect(await mine(sup.id)).toBe(1);
    expect(await mine(pm.id)).toBe(1);
    expect(await mine(owner.id)).toBe(0);

    // 13:30 – management (3.5 hours late)
    await runReportReminders(company, new Date(todayAt(13, 30)));
    expect(await mine(owner.id)).toBe(1);
  });

  it("does not chase a report that was already sent", async () => {
    const p = await proj("PRJ-00001");
    await db.notification.deleteMany({ where: { type: "REPORT_MISSING", dedupeKey: { contains: p.id } } });
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    await db.dailyReport.create({ data: { companyId: p.companyId, projectId: p.id, reportDate: reportDay(), kind: "MORNING", submittedById: sup.id, planNext: "x", manpower: 3 } });
    await runReportReminders(p.companyId, new Date(todayAt(14, 0)));
    expect(await count({ dedupeKey: { contains: `${p.id}:${istParts().date}:MORNING` } })).toBe(0);
    await db.dailyReport.deleteMany({ where: { projectId: p.id, reportDate: reportDay() } });
  });
});

describe("sending a site report", () => {
  it("morning update needs a plan and a start-of-day photo; sending it records people, plan and lateness", async () => {
    const p = await proj("PRJ-00001");
    await loginAs("supervisor@dsc.demo");
    const base = { projectId: p.id, kind: "MORNING", manpower: 12 };
    expect((await submitSiteReport(fd({ ...base }))).ok).toBe(false);
    const noPhoto = await submitSiteReport(fd({ ...base, planNext: "Tile work in hall" }));
    expect(noPhoto.ok === false && noPhoto.error).toMatch(/start-of-day photo/);
    const withPhoto = fd({ ...base, planNext: "Tile work in hall" }); withPhoto.append("photos", jpeg("morning.jpg"));
    const r = await submitSiteReport(withPhoto);
    expect(r.ok).toBe(true);
    const row = await db.dailyReport.findFirstOrThrow({ where: { projectId: p.id, reportDate: reportDay(), kind: "MORNING" } });
    expect(row.manpower).toBe(12);
    expect(row.planNext).toBe("Tile work in hall");
    expect(typeof row.onTime).toBe("boolean");
    expect(row.photoIds).toHaveLength(1);
  });

  it("sending again the same day updates the report instead of duplicating it (the morning photo is already there)", async () => {
    const p = await proj("PRJ-00001");
    await loginAs("supervisor@dsc.demo");
    expect((await submitSiteReport(fd({ projectId: p.id, kind: "MORNING", manpower: 15, planNext: "Tile work + ceiling" }))).ok).toBe(true);
    const rows = await db.dailyReport.findMany({ where: { projectId: p.id, reportDate: reportDay(), kind: "MORNING" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].manpower).toBe(15);
  });

  it("evening report needs work done and at least one photo; photos become site-photo documents", async () => {
    const p = await proj("PRJ-00001");
    await loginAs("supervisor@dsc.demo");
    const base = { projectId: p.id, kind: "EVENING", manpower: 14, progressPct: 40, workDone: "Hall flooring finished" };
    expect((await submitSiteReport(fd({ ...base, workDone: "" }))).ok).toBe(false);
    expect((await submitSiteReport(fd({ ...base }))).ok).toBe(false); // no photo
    const f = fd({ ...base });
    f.append("photos", jpeg("a.jpg"));
    f.append("photos", jpeg("b.jpg"));
    expect((await submitSiteReport(f)).ok).toBe(true);
    const row = await db.dailyReport.findFirstOrThrow({ where: { projectId: p.id, reportDate: reportDay(), kind: "EVENING" } });
    expect(row.photoIds).toHaveLength(2);
    expect(row.progressPct).toBe(40);
    const docs = await db.document.findMany({ where: { id: { in: row.photoIds } } });
    expect(docs.every((d) => d.type === "SITE_PHOTO" && d.entityType === "PROJECT" && d.entityId === p.id)).toBe(true);

    // a later update keeps the earlier photos
    const g = fd({ ...base, progressPct: 45 });
    g.append("photos", jpeg("c.jpg"));
    expect((await submitSiteReport(g)).ok).toBe(true);
    const again = await db.dailyReport.findFirstOrThrow({ where: { id: row.id } });
    expect(again.photoIds).toHaveLength(3);
    expect(again.progressPct).toBe(45);
  });

  it("rejects non-image files and more than 10 photos", async () => {
    const p = await proj("PRJ-00001");
    await loginAs("supervisor@dsc.demo");
    const base = { projectId: p.id, kind: "EVENING", manpower: 5, workDone: "x" };
    const pdf = fd({ ...base });
    pdf.append("photos", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "plan.pdf", { type: "application/pdf" }));
    expect((await submitSiteReport(pdf)).ok).toBe(false);
    const many = fd({ ...base });
    for (let i = 0; i < 11; i++) many.append("photos", jpeg(`p${i}.jpg`));
    expect((await submitSiteReport(many)).ok).toBe(false);
    const fake = fd({ ...base });
    fake.append("photos", new File([new Uint8Array([1, 2, 3, 4])], "fake.jpg", { type: "image/jpeg" }));
    expect((await submitSiteReport(fake)).ok).toBe(false); // contents are not a JPEG
  });

  it("work-stopped / shortage alerts the project manager and procurement", async () => {
    const p = await proj("PRJ-00001");
    const pm = await db.user.findFirstOrThrow({ where: { id: p.projectManagerId! } });
    const buyer = await db.user.findFirstOrThrow({ where: { email: "procurement@dsc.demo" } });
    const before = await db.notification.count({ where: { userId: { in: [pm.id, buyer.id] }, title: { contains: "PRJ-00001" } } });
    await loginAs("supervisor@dsc.demo");
    const r = await submitSiteReport(fd({ projectId: p.id, kind: "MORNING", manpower: 15, planNext: "Tile work + ceiling", materialStatus: "WORK_STOPPED", issues: "No tiles at site" }));
    expect(r.ok).toBe(true);
    const n = await db.notification.findMany({ where: { userId: { in: [pm.id, buyer.id] }, title: { contains: "PRJ-00001" } } });
    expect(n.length).toBeGreaterThan(before);
    expect(n.some((x) => x.userId === pm.id && /WORK STOPPED/.test(x.title))).toBe(true);
    expect(n.some((x) => x.userId === buyer.id && /work stopped/.test(x.title))).toBe(true);
  });

  it("only people on the site can report for it", async () => {
    const mine = await proj("PRJ-00001");
    const notMine = await proj("PRJ-00004"); // no supervisor / engineer
    await loginAs("supervisor@dsc.demo");
    expect((await submitSiteReport(fd({ projectId: notMine.id, kind: "MORNING", manpower: 2, planNext: "x" }))).ok).toBe(false);
    await loginAs("sales@dsc.demo");
    expect((await submitSiteReport(fd({ projectId: mine.id, kind: "MORNING", manpower: 2, planNext: "x" }))).ok).toBe(false);
    logout();
    expect((await submitSiteReport(fd({ projectId: mine.id, kind: "MORNING", manpower: 2, planNext: "x" }))).ok).toBe(false);
  });

  it("closed projects take no reports", async () => {
    const closed = await proj("PRJ-00005");
    await loginAs("owner@dsc.demo");
    expect((await submitSiteReport(fd({ projectId: closed.id, kind: "MORNING", manpower: 2, planNext: "x" }))).ok).toBe(false);
  });
});
