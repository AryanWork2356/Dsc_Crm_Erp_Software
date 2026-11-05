import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { giveWork, markWorkDone, removeWork, saveDailyReport } from "@/app/(app)/daily-work/actions";
import { reportDay } from "@/lib/site-reports";
import { can, OFFICE_ROLES } from "@/lib/permissions";
import { menuFor } from "@/lib/nav";
import { createProject, updateProject } from "@/app/(app)/projects/actions";
import { tradeVendorOptions, projectTradeVendors } from "@/lib/project-vendors";
import { vendorTrades } from "@/lib/trades";
import { formatDuration } from "@/lib/utils";

beforeEach(() => logout());
const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`;

describe("daily work: given by directors, finished by the office employee", () => {
  it("the time it was given and finished are recorded, and the director is told", async () => {
    const designer = await db.user.findFirstOrThrow({ where: { email: "designer@dsc.demo" } });
    await loginAs("director@dsc.demo");
    const title = `Send quotation ${tag()}`;
    const g = await giveWork(fd({ assignedToId: designer.id, title, dueDate: "2030-01-01", dueTime: "17:30" }));
    expect(g.ok).toBe(true);
    const w = await db.dailyWork.findFirstOrThrow({ where: { assignedToId: designer.id, title } });
    expect(w.status).toBe("PENDING");
    expect(w.createdAt).toBeInstanceOf(Date);
    expect(w.dueAt?.toISOString()).toBe("2030-01-01T12:00:00.000Z"); // 17:30 India time
    expect(await db.notification.count({ where: { userId: designer.id, title: { startsWith: "New work from" } } })).toBeGreaterThan(0);

    await loginAs("accounts@dsc.demo"); // somebody else cannot finish it
    expect((await markWorkDone(w.id, fd({}))).ok).toBe(false);
    await loginAs("designer@dsc.demo");
    expect((await markWorkDone(w.id, fd({ note: "Sent at 12" }))).ok).toBe(true);
    const done = await db.dailyWork.findUniqueOrThrow({ where: { id: w.id } });
    expect(done.status).toBe("DONE");
    expect(done.doneAt).toBeInstanceOf(Date);
    expect(done.doneNote).toBe("Sent at 12");
    const director = await db.user.findFirstOrThrow({ where: { email: "director@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: director.id, title: { contains: "finished the work" } } })).toBeGreaterThan(0);
    await loginAs("director@dsc.demo"); // finished work stays in the record
    expect((await removeWork(w.id)).ok).toBe(false);
  });

  it("only directors give work; everyone reaches every office employee and nobody else", async () => {
    await loginAs("admin@dsc.demo");
    expect((await giveWork(fd({ assignedToId: "ALL", title: "Admin try" }))).ok).toBe(false);
    await loginAs("supervisor@dsc.demo");
    expect((await giveWork(fd({ assignedToId: "ALL", title: "Coordinator try" }))).ok).toBe(false);
    await loginAs("director@dsc.demo");
    const title = `For all ${tag()}`;
    expect((await giveWork(fd({ assignedToId: "ALL", title }))).ok).toBe(true);
    const rows = await db.dailyWork.findMany({ where: { title } });
    const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.assignedToId) } }, select: { role: true } });
    expect(rows.length).toBeGreaterThan(1);
    for (const u of users) expect(OFFICE_ROLES).toContain(u.role);
    expect((await removeWork(rows[0].id)).ok).toBe(true); // a director takes back pending work
  });

  it("the daily report: office staff write it once a day (writing again replaces it); coordinators and directors do not", async () => {
    await loginAs("designer@dsc.demo");
    expect((await saveDailyReport(fd({ body: "Made the BOQ for Thane" }))).ok).toBe(true);
    expect((await saveDailyReport(fd({ body: "Made the BOQ and called two clients" }))).ok).toBe(true);
    const me = await db.user.findFirstOrThrow({ where: { email: "designer@dsc.demo" } });
    const rows = await db.dailyLog.findMany({ where: { userId: me.id, day: reportDay() } });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain("called two clients");
    // the directors are told once for the day, even if the report is edited
    const directors = await db.user.findMany({ where: { role: { in: ["OWNER", "MANAGEMENT"] } }, select: { id: true } });
    const told = () => db.notification.count({ where: { userId: { in: directors.map((x) => x.id) }, dedupeKey: `dailylog:${me.id}:${reportDay().toISOString().slice(0, 10)}` } });
    expect(await told()).toBe(directors.length);
    await saveDailyReport(fd({ body: "Made the BOQ and called three clients" }));
    expect(await told()).toBe(directors.length);
    expect((await saveDailyReport(fd({ body: "tomorrow", day: "2099-01-01" }))).ok).toBe(false);
    expect((await saveDailyReport(fd({ body: "too old", day: "2020-01-01" }))).ok).toBe(false);
    await loginAs("supervisor@dsc.demo");
    expect((await saveDailyReport(fd({ body: "Coordinator report" }))).ok).toBe(false);
    await loginAs("director@dsc.demo");
    expect((await saveDailyReport(fd({ body: "Director report" }))).ok).toBe(false);
  });

  it("says how long work took", () => {
    expect(formatDuration(20 * 1000)).toBe("under 1 min");
    expect(formatDuration(25 * 60000)).toBe("25 min");
    expect(formatDuration(100 * 60000)).toBe("1 h 40 min");
    expect(formatDuration(26 * 3600000)).toBe("1 d 2 h");
  });

  it("the Daily Work menu is for office staff and directors, not coordinators", () => {
    const has = (role: Parameters<typeof menuFor>[0]) => menuFor(role, (p) => can(role, p)).flatMap((g) => (g.href ? [g.href] : g.items.map((i) => i.href))).includes("/daily-work");
    for (const r of ["OWNER", "MANAGEMENT", "ADMIN", "PROJECT_MANAGER", "DESIGNER", "HR", "ACCOUNTS"] as const) expect(has(r), r).toBe(true);
    for (const r of ["SITE_SUPERVISOR", "SITE_ENGINEER"] as const) expect(has(r), r).toBe(false);
  });
});

describe("work types and vendors on a project", () => {
  it("understands the kinds of work in the supplier list", () => {
    expect(vendorTrades("Glass/Mdf/Ply Supplier")).toEqual(expect.arrayContaining(["GLASS", "MDF", "PLYWOOD"]));
    expect(vendorTrades("PLY & Laminate Supplier")).toEqual(expect.arrayContaining(["PLYWOOD", "LAMINATE"]));
    expect(vendorTrades("Plywood Supplier")).not.toContain("CARPENTRY");
    expect(vendorTrades("Carpenting Supplier")).toContain("CARPENTRY");
    expect(vendorTrades("Edge bind")).toContain("EDGE_BAND");
    expect(vendorTrades("Matress Supplier")).toContain("MATTRESS");
  });

  it("each work type offers only the vendors who do that work; unticked work is removed from the project", async () => {
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const t = tag();
    const ply = await db.vendor.create({ data: { companyId: company.id, code: `V-PL${t}`, name: `Ply House ${t}`, trades: "Plywood" } });
    const hw = await db.vendor.create({ data: { companyId: company.id, code: `V-HW${t}`, name: `Hardware Hub ${t}`, trades: "Hardware" } });
    const opts = await tradeVendorOptions(company.id);
    expect(opts.PLYWOOD.map((o) => o.value)).toContain(ply.id);
    expect(opts.PLYWOOD.map((o) => o.value)).not.toContain(hw.id);
    expect(opts.HARDWARE.map((o) => o.value)).toContain(hw.id);

    await loginAs("director@dsc.demo");
    const r = await createProject(fd({ name: `Work types ${t}`, clientId: client.id, trades_form: "1", vendor_PLYWOOD: ply.id, vendor_HARDWARE: hw.id }));
    expect(r.ok).toBe(true);
    const id = (r as { data: { id: string } }).data.id;
    expect((await projectTradeVendors(id)).map((x) => x.trade)).toEqual(["HARDWARE", "PLYWOOD"]);
    // the form is sent with only Plywood ticked: Hardware is dropped
    expect((await updateProject(id, fd({ name: `Work types ${t}`, clientId: client.id, trades_form: "1", vendor_PLYWOOD: ply.id }))).ok).toBe(true);
    expect((await projectTradeVendors(id)).map((x) => x.trade)).toEqual(["PLYWOOD"]);
    // a vendor that does not exist in the company is refused
    expect((await updateProject(id, fd({ name: `Work types ${t}`, clientId: client.id, trades_form: "1", vendor_PLYWOOD: "nope" }))).ok).toBe(false);
  });
});
