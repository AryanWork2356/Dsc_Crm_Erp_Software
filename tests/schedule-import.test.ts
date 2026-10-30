import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { parseMaterialNeeds, parseSchedule, type Raw } from "@/lib/schedule-import";
import { readScheduleFile } from "@/lib/schedule-file";
import { scheduleTemplate } from "@/lib/schedule-template";
import { readTable } from "@/lib/importer";
import { importSchedule } from "@/app/(app)/projects/actions";
import sample from "@/lib/schedule-sample.json";

beforeEach(() => logout());
const START = new Date(Date.UTC(2026, 10, 2)); // 02 Nov 2026
const asRaw = (header: string[], rows: (string | number)[][]): Raw[] => rows.map((r) => Object.fromEntries(header.map((h, i) => [h, String(r[i] ?? "")])));
const sampleRaw = () => asRaw(sample.header, sample.rows as (string | number)[][]);
const iso = (d?: Date) => d?.toISOString().slice(0, 10);

describe("reading a schedule", () => {
  it("the 25-day example: day numbers become dates from the project start, and every dependency is found", () => {
    const { tasks, errors } = parseSchedule(sampleRaw(), START);
    expect(errors).toEqual([]);
    expect(tasks).toHaveLength(15);
    expect(iso(tasks[0].start)).toBe("2026-11-02"); // day 1
    expect(iso(tasks[0].due)).toBe("2026-11-04"); // day 3
    expect(iso(tasks.at(-1)!.due)).toBe("2026-11-26"); // day 25
    expect(tasks[7]).toMatchObject({ name: "Carpentry carcass: wardrobes", zone: "Master and kids bedroom", trade: "Carpenter", headcount: 6, qty: 98, unit: "sqft", priority: "HIGH", dependsOn: "1" });
  });

  it("real dates in several styles work, and need no project start", () => {
    const { tasks, errors } = parseSchedule(asRaw(["Task", "Start", "Due"], [["A", "05-11-2026", "12 Nov 2026"], ["B", "2026-11-13", "13/11/26"]]), null);
    expect(errors).toEqual([]);
    expect(tasks.map((t) => [iso(t.start), iso(t.due)])).toEqual([["2026-11-05", "2026-11-12"], ["2026-11-13", "2026-11-13"]]);
  });

  it("a start day with a duration works too", () => {
    const { tasks } = parseSchedule(asRaw(["Activity", "Start day", "Duration"], [["Painting", 5, 3]]), START);
    expect([iso(tasks[0].start), iso(tasks[0].due)]).toEqual(["2026-11-06", "2026-11-08"]);
  });

  it("names the row and the reason for every mistake, and adds nothing partly", () => {
    const H = ["Sl No", "Task", "Trade", "People needed", "Start", "Due", "Depends on", "Priority"];
    const { errors } = parseSchedule(asRaw(H, [
      [1, "Fine task", "Civil", 3, "05-11-2026", "06-11-2026", "", "High"],
      [2, "Backwards", "Civil", 3, "10-11-2026", "06-11-2026", "", ""],
      [3, "No dates", "", "", "", "", "", ""],
      [4, "Bad people", "", "lots", "05-11-2026", "06-11-2026", "", ""],
      [5, "Bad link", "", "", "05-11-2026", "06-11-2026", "9", ""],
      [6, "Later link", "", "", "05-11-2026", "06-11-2026", "7", ""],
      [7, "Bad priority", "", "", "05-11-2026", "06-11-2026", "", "whenever"],
      [8, "Not a date", "", "", "tomorrow", "", "", ""],
    ]), START);
    const rows = errors.map((e) => e.row);
    expect(rows).toEqual(expect.arrayContaining([3, 4, 5, 6, 7, 8, 9]));
    expect(errors.find((e) => e.row === 3)!.message).toMatch(/Due date is before/);
    expect(errors.find((e) => e.row === 4)!.message).toMatch(/add the dates/);
    expect(errors.find((e) => e.row === 5)!.message).toMatch(/People needed/);
    expect(errors.find((e) => e.row === 6)!.message).toMatch(/Depends on 9/);
    expect(errors.find((e) => e.row === 7)!.message).toMatch(/Depends on 7/); // a task below it
    expect(errors.find((e) => e.row === 8)!.message).toMatch(/Priority/);
    expect(errors.find((e) => e.row === 9)!.message).toMatch(/not a date/);
    expect(errors.find((e) => e.row === 2)).toBeUndefined();
  });

  it("explains when the project has no start date for day numbers, when there is no Task column, and when there are too many rows", () => {
    expect(parseSchedule(asRaw(["Task", "Start day", "End day"], [["A", 1, 3]]), null).errors[0].message).toMatch(/no start date/);
    expect(parseSchedule([{ Foo: "x" }], START).errors[0].message).toMatch(/no “Task” column/);
    expect(parseSchedule(Array.from({ length: 201 }, (_, i) => ({ Task: `T${i}`, "Start day": "1", "End day": "1" })), START).errors[0].message).toMatch(/Too many rows/);
    expect(parseSchedule([], START).errors).toHaveLength(1);
  });

  it("the template people download can be uploaded straight back: the work and its Materials sheet", async () => {
    const buf = await scheduleTemplate();
    const file = new File([new Uint8Array(buf)], "DSC_Schedule_Template.xlsx");
    const rows = await readTable(file);
    expect(rows).toHaveLength(15);
    expect(parseSchedule(rows, START).errors).toEqual([]);
    const both = await readScheduleFile(file);
    expect(both.work).toHaveLength(15);
    expect(both.materials).toHaveLength(13);
    const { tasks } = parseSchedule(both.work, START);
    const m = parseMaterialNeeds(both.materials, START, tasks);
    expect(m.errors).toEqual([]);
    expect(m.lines[0]).toMatchObject({ description: "Waterproofing compound (2 part)", qty: 6, unit: "kits", forWork: "Bathroom waterproofing and ponding test" });
    expect(iso(m.lines[0].neededBy)).toBe("2026-11-07"); // day 6
  });

  it("checks the Materials sheet the same way: every mistake named, with the material", () => {
    const H = ["Material", "Quantity", "Unit", "Needed day", "Needed on"];
    const { lines, errors } = parseMaterialNeeds(asRaw(H, [
      ["Plywood", 40, "sheets", 9, ""],
      ["Adhesive", "", "bags", 8, ""],
      ["Putty", 30, "bags", "", ""],
      ["Paint", 80, "litres", "", "tomorrow"],
      ["Laminate", 36, "sheets", "", "20-11-2026"],
    ]), START);
    expect(lines.map((l) => [l.description, iso(l.neededBy)])).toEqual([["Plywood", "2026-11-10"], ["Laminate", "2026-11-20"]]);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(errors[0].message).toMatch(/Materials sheet: “Adhesive”: Quantity/);
    expect(errors[1].message).toMatch(/say when it is needed/);
    expect(parseMaterialNeeds(asRaw(["Material", "Quantity", "Needed day"], [["Ply", 4, 3]]), null).errors[0].message).toMatch(/no start date/);
    expect(parseMaterialNeeds([], START)).toEqual({ lines: [], errors: [] });
  });
});

async function xlsx(header: string[], rows: (string | number)[][], name = "schedule.xlsx") {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Schedule");
  ws.addRow(header); rows.forEach((r) => ws.addRow(r));
  return new File([new Uint8Array(Buffer.from(await wb.xlsx.writeBuffer()))], name);
}
async function newProject(startDate: Date | null = START) {
  const company = await db.company.findFirstOrThrow();
  const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
  return db.project.create({ data: { companyId: company.id, code: `PRJ-SC${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`, name: "Schedule test", clientId: client.id, status: "EXECUTION", startDate } });
}

describe("uploading a schedule to a project", () => {
  it("adds every task with its dates, dependencies and committed date, and refuses a second upload unless told to add", async () => {
    await loginAs("owner@dsc.demo");
    const p = await newProject();
    const form = (f: File, extra: Record<string, string> = {}) => { const x = fd(extra); x.set("file", f); return x; };
    const r = await importSchedule(p.id, form(await xlsx(sample.header, sample.rows as (string | number)[][])));
    expect(r.ok && r.message).toMatch(/15 tasks/);
    const tasks = await db.projectTask.findMany({ where: { projectId: p.id }, orderBy: { code: "asc" } });
    expect(tasks).toHaveLength(15);
    const byName = new Map(tasks.map((t) => [t.name, t]));
    const tiling = byName.get("Floor tiling")!;
    expect(iso(tiling.startDate!)).toBe("2026-11-11"); // day 10
    expect(iso(tiling.baselineDue!)).toBe("2026-11-16"); // day 15, committed
    expect(tiling.dependsOnId).toBe(byName.get("Wall repair and plaster patching")!.id);
    expect(tiling).toMatchObject({ zone: "Hall, dining, bedrooms", requiredTrade: "Civil", requiredHeadcount: 4, qtyUnit: "sqft" });
    expect(Number(tiling.plannedQty)).toBe(1100);
    // again: refused unless the person says to add to what is there
    const again = await importSchedule(p.id, form(await xlsx(["Task", "Start day", "End day"], [["Extra", 1, 2]])));
    expect(again.ok === false && again.error).toMatch(/already has 15 tasks and 0 material lines/);
    expect((await importSchedule(p.id, form(await xlsx(["Task", "Start day", "End day"], [["Extra", 1, 2]]), { addToExisting: "on" }))).ok).toBe(true);
    expect(await db.projectTask.count({ where: { projectId: p.id } })).toBe(16);
  });

  it("the template file adds the work AND the materials list, each material linked to its work", async () => {
    await loginAs("director@dsc.demo");
    const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
    const p = await newProject();
    await db.project.update({ where: { id: p.id }, data: { projectManagerId: pm.id } });
    const x = fd({}); x.set("file", new File([new Uint8Array(await scheduleTemplate())], "DSC_Schedule_Template.xlsx"));
    const r = await importSchedule(p.id, x);
    expect(r.ok && r.message).toMatch(/15 tasks and 13 material lines/);
    const needs = await db.materialNeed.findMany({ where: { projectId: p.id }, orderBy: { neededBy: "asc" } });
    expect(needs).toHaveLength(13);
    const ply = needs.filter((n) => n.description === "18 mm BWP plywood");
    expect(ply.map((n) => iso(n.neededBy))).toEqual(["2026-11-10", "2026-11-14"]);
    const carcass = await db.projectTask.findFirstOrThrow({ where: { projectId: p.id, name: "Carpentry carcass: wardrobes" } });
    expect(ply[0]).toMatchObject({ taskId: carcass.id, forWork: "Carpentry carcass: wardrobes", unit: "sheets" });
    // a wrong material row stops the whole file, work included
    const q = await newProject(); await db.project.update({ where: { id: q.id }, data: { projectManagerId: pm.id } });
    const wb = new ExcelJS.Workbook(); wb.addWorksheet("Schedule").addRows([["Task", "Start day", "End day"], ["Tiling", 1, 3]]); wb.addWorksheet("Materials").addRows([["Material", "Quantity", "Needed day"], ["Tiles", "lots", 1]]);
    const y = fd({}); y.set("file", new File([new Uint8Array(Buffer.from(await wb.xlsx.writeBuffer()))], "s.xlsx"));
    const bad = await importSchedule(q.id, y);
    expect(bad.ok === false && bad.error).toMatch(/Nothing was added.*Materials sheet: “Tiles”/);
    expect(await db.projectTask.count({ where: { projectId: q.id } })).toBe(0);
  });

  it("adds nothing at all when one row is wrong, and says which", async () => {
    await loginAs("owner@dsc.demo");
    const p = await newProject();
    const f = await xlsx(["Task", "Start day", "End day"], [["Good", 1, 3], ["Bad", 5, "x"], ["Also good", 2, 4]]);
    const x = fd({}); x.set("file", f);
    const r = await importSchedule(p.id, x);
    expect(r.ok === false && r.error).toMatch(/Nothing was added.*row 3/);
    expect(await db.projectTask.count({ where: { projectId: p.id } })).toBe(0);
  });

  it("is for people who may add tasks, on projects they can open", async () => {
    const p = await newProject();
    await loginAs("store@dsc.demo");
    const x = fd({}); x.set("file", await xlsx(["Task", "Start day", "End day"], [["A", 1, 2]]));
    expect((await importSchedule(p.id, x)).ok).toBe(false);
    await loginAs("pm@dsc.demo"); // DSC: managers and coordinators see the schedule but do not upload it
    const y = fd({}); y.set("file", await xlsx(["Task", "Start day", "End day"], [["A", 1, 2]]));
    expect((await importSchedule(p.id, y)).ok).toBe(false);
    expect(await db.projectTask.count({ where: { projectId: p.id } })).toBe(0);
  });
});
