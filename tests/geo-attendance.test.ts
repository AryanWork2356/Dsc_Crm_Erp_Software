import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { calendarDay } from "@/lib/utils";
import { checkPresence, distanceM } from "@/lib/geo";
import { checkIn } from "@/app/(app)/workforce/actions";
import { saveAttendanceLocation, setSiteLocation } from "@/app/(app)/workforce/location-actions";

beforeEach(() => logout());

// 1 degree of latitude is about 111,195 m
const SITE = { lat: 19.2183, lng: 72.9781 };
const at = (metres: number) => ({ lat: SITE.lat + metres / 111195, lng: SITE.lng });

describe("distance and presence rules", () => {
  it("measures metres between two points", () => {
    expect(Math.round(distanceM(SITE, at(20)))).toBe(20);
    expect(distanceM(SITE, SITE)).toBe(0);
  });
  it("accepts a clear fix inside the radius, with the distance", () => {
    const v = checkPresence({ ...at(12), accuracyM: 6, at: 1000 }, SITE, 20, 1000);
    expect(v).toMatchObject({ ok: true, distanceM: 12, accuracyM: 6 });
  });
  it("refuses far, unclear, old and missing fixes with a reason", () => {
    expect(checkPresence({ ...at(35), accuracyM: 5 }, SITE, 20)).toMatchObject({ ok: false, code: "FAR", distanceM: 35 });
    expect(checkPresence({ ...at(5), accuracyM: 90 }, SITE, 20)).toMatchObject({ ok: false, code: "WEAK" });
    expect(checkPresence({ ...at(5), accuracyM: 5, at: 0 }, SITE, 20, 10 * 60 * 1000)).toMatchObject({ ok: false, code: "STALE" });
    expect(checkPresence(null, SITE, 20)).toMatchObject({ ok: false, code: "NO_FIX" });
    expect(checkPresence({ lat: 999, lng: 0 }, SITE, 20)).toMatchObject({ ok: false, code: "NO_FIX" });
  });
});

describe("self-marked attendance needs the phone to be at the site", () => {
  let projectId = "";
  let workerId = "";
  const clear = async () => {
    await db.attendance.deleteMany({ where: { workerId, date: calendarDay() } });
  };

  it("works for a worker at their site, and stores how far away they were", async () => {
    const w = await db.worker.findFirstOrThrow({ where: { code: "W-00001" } });
    workerId = w.id;
    projectId = w.currentProjectId!;
    await db.companySettings.updateMany({ data: { geoRequired: true, geoRadiusM: 20 } });
    await db.project.update({ where: { id: projectId }, data: { siteLat: SITE.lat, siteLng: SITE.lng, geoRadiusM: null } });
    await clear();
    await loginAs("w-00001@workers.local");
    expect((await checkIn(undefined, at(60).lat, at(60).lng, 8, Date.now())).ok).toBe(false); // 60 m away
    expect((await checkIn(undefined)).ok).toBe(false); // no location at all
    expect((await checkIn(undefined, at(5).lat, at(5).lng, 120, Date.now())).ok).toBe(false); // phone is unsure
    expect((await checkIn(undefined, at(5).lat, at(5).lng, 8, Date.now() - 10 * 60 * 1000)).ok).toBe(false); // old position
    expect(await db.attendance.count({ where: { workerId, date: calendarDay() } })).toBe(0);
    const r = await checkIn(undefined, at(14).lat, at(14).lng, 9, Date.now());
    expect(r.ok).toBe(true);
    const rec = await db.attendance.findFirstOrThrow({ where: { workerId, date: calendarDay() } });
    expect(rec).toMatchObject({ method: "LOCATION", status: "PRESENT", distanceM: 14, accuracyM: 9 });
  });

  it("uses the project own distance when it has one, else the company default", async () => {
    await clear();
    await db.project.update({ where: { id: projectId }, data: { geoRadiusM: 60 } });
    await loginAs("w-00001@workers.local");
    expect((await checkIn(undefined, at(45).lat, at(45).lng, 8, Date.now())).ok).toBe(true);
    await clear();
    await db.project.update({ where: { id: projectId }, data: { geoRadiusM: null } });
    expect((await checkIn(undefined, at(45).lat, at(45).lng, 8, Date.now())).ok).toBe(false);
  });

  it("says so when the site has no location yet, and lets people through when the company switches the rule off", async () => {
    await clear();
    await db.project.update({ where: { id: projectId }, data: { siteLat: null, siteLng: null } });
    await loginAs("w-00001@workers.local");
    const r = await checkIn(undefined, SITE.lat, SITE.lng, 5, Date.now());
    expect(r.ok === false && r.error).toMatch(/not set yet/);
    await db.companySettings.updateMany({ data: { geoRequired: false } });
    expect((await checkIn(undefined)).ok).toBe(true);
    expect((await db.attendance.findFirstOrThrow({ where: { workerId, date: calendarDay() } })).method).toBe("MOBILE");
    await db.companySettings.updateMany({ data: { geoRequired: true } });
    await clear();
  });

  it("staff mark at the office or a site they work on", async () => {
    const emp = await db.employee.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    await db.attendance.deleteMany({ where: { employeeId: emp.id, date: calendarDay() } });
    await db.companySettings.updateMany({ data: { officeLat: null, officeLng: null, geoRequired: true, geoRadiusM: 20 } });
    await loginAs("supervisor@dsc.demo");
    expect((await checkIn("office", SITE.lat, SITE.lng, 5, Date.now())).ok).toBe(false); // office location not set
    await db.companySettings.updateMany({ data: { officeLat: SITE.lat, officeLng: SITE.lng } });
    expect((await checkIn("office", at(80).lat, at(80).lng, 5, Date.now())).ok).toBe(false);
    expect((await checkIn("office", at(8).lat, at(8).lng, 5, Date.now())).ok).toBe(true);
    const rec = await db.attendance.findFirstOrThrow({ where: { employeeId: emp.id, date: calendarDay() } });
    expect(rec).toMatchObject({ projectId: null, method: "LOCATION", distanceM: 8 });
    expect((await checkIn("office", at(80).lat, at(80).lng, 5, Date.now())).ok).toBe(true); // already marked: no second check
  });
});

describe("saving locations", () => {
  it("a project site location is validated and needs project edit access", async () => {
    const p = await db.project.findFirstOrThrow({ where: { code: "PRJ-00001" } });
    await loginAs("owner@dsc.demo");
    expect((await setSiteLocation(p.id, fd({ lat: "abc", lng: "72.9" }))).ok).toBe(false);
    expect((await setSiteLocation(p.id, fd({ lat: "95", lng: "72.9" }))).ok).toBe(false);
    expect((await setSiteLocation(p.id, fd({ lat: "", lng: "" }))).ok).toBe(false);
    expect((await setSiteLocation(p.id, fd({ lat: "19.2183", lng: "72.9781", radius: "2" }))).ok).toBe(false);
    expect((await setSiteLocation(p.id, fd({ lat: "19.2183", lng: "72.9781", radius: "35" }))).ok).toBe(true);
    expect(await db.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ siteLat: 19.2183, siteLng: 72.9781, geoRadiusM: 35 });
    expect((await setSiteLocation(p.id, fd({ lat: "19.2183", lng: "72.9781" }))).ok).toBe(true); // blank = company default
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).geoRadiusM).toBeNull();
    await loginAs("store@dsc.demo");
    expect((await setSiteLocation(p.id, fd({ lat: "19.2", lng: "72.9" }))).ok).toBe(false);
  });

  it("the site supervisor standing at the site can save its location, but only on a project they are named on", async () => {
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const mine = await db.project.create({ data: { companyId: company.id, code: `PRJ-SL${Date.now().toString(36)}`, name: "Supervisor site", clientId: client.id, status: "EXECUTION", supervisorId: sup.id, members: { create: [{ userId: sup.id, roleLabel: "Supervisor" }] } } });
    const notMine = await db.project.create({ data: { companyId: company.id, code: `PRJ-SM${Date.now().toString(36)}`, name: "Someone else's site", clientId: client.id, status: "EXECUTION" } });
    await loginAs("supervisor@dsc.demo");
    expect((await setSiteLocation(mine.id, fd({ lat: "19.2183", lng: "72.9781" }))).ok).toBe(true);
    expect(await db.project.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ siteLat: 19.2183, siteLng: 72.9781 });
    expect((await setSiteLocation(notMine.id, fd({ lat: "19.2183", lng: "72.9781" }))).ok).toBe(false);
  });

  it("only people who manage settings change the company rule", async () => {
    await loginAs("supervisor@dsc.demo");
    expect((await saveAttendanceLocation(fd({ radius: "20", geoRequired: "on" }))).ok).toBe(false);
    await loginAs("owner@dsc.demo");
    expect((await saveAttendanceLocation(fd({ radius: "1" }))).ok).toBe(false);
    expect((await saveAttendanceLocation(fd({ radius: "30", geoRequired: "on", lat: "19.2", lng: "72.9" }))).ok).toBe(true);
    expect(await db.companySettings.findFirstOrThrow()).toMatchObject({ geoRadiusM: 30, geoRequired: true, officeLat: 19.2, officeLng: 72.9 });
    expect((await saveAttendanceLocation(fd({ radius: "20", geoRequired: "on" }))).ok).toBe(true);
    expect(await db.companySettings.findFirstOrThrow()).toMatchObject({ geoRadiusM: 20, officeLat: null });
  });
});
