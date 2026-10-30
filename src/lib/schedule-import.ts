import type { Priority } from "@prisma/client";

/**
 * Reads a project schedule typed in Excel: one row per task. Dates can be real dates, or day numbers counted from the project's start date
 * (Start day 1 = the start date), which suits "a 25 day plan". Pure rows in, plain tasks out, so it can be tested without a database.
 * Everything is checked before anything is saved: one bad row means nothing is added, and the message says which row and why.
 */
export type Raw = Record<string, string>;
export type ScheduleTask = {
  row: number; sl: string; name: string; zone?: string; trade?: string; headcount?: number; start?: Date; due?: Date;
  qty?: number; unit?: string; dependsOn?: string; priority: Priority; details?: string; assignee?: string;
};
export const MAX_SCHEDULE_ROWS = 200;

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const ALIASES: Record<string, string[]> = {
  sl: ["#", "slno", "srno", "sno", "no", "id", "sl", "ref", "serial", "serialno"],
  name: ["task", "taskname", "activity", "workitem", "work", "item", "name", "description"],
  zone: ["area", "zone", "areazone", "location", "room"],
  trade: ["trade", "tradeneeded", "team", "crew"],
  headcount: ["peopleneeded", "people", "persons", "manpower", "headcount", "workers", "noofpeople"],
  start: ["start", "startdate", "from", "fromdate"],
  due: ["due", "duedate", "end", "enddate", "finish", "finishdate", "to", "todate", "completeby"],
  startDay: ["startday", "fromday", "daystart", "dayfrom", "beginday"],
  endDay: ["endday", "today", "dayend", "dayto", "finishday", "lastday"],
  duration: ["duration", "durationdays", "days", "nodays", "noofdays"],
  qty: ["plannedquantity", "quantity", "qty", "plannedqty"],
  unit: ["unit", "uom"],
  dependsOn: ["dependson", "after", "predecessor", "depends", "dependency", "startsafter"],
  priority: ["priority"],
  details: ["details", "notes", "remarks", "comments", "note"],
  assignee: ["assignedto", "assigned", "assignee", "incharge", "responsible", "personincharge", "owner"],
};

/** Which header of the file is which column (the first match wins; "description" is only the task name when nothing better exists). */
function columns(headers: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    for (const n of names) {
      const h = headers.find((x) => key(x) === n && !Object.values(out).includes(x));
      if (h) { out[field] = h; break; }
    }
  }
  return out;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const utc = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : null; };

export function parseDay(v: string): Date | null {
  const t = v.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return utc(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2}|\d{4})$/.exec(t);
  if (m) return utc(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-.,]*([A-Za-z]{3})[a-z]*[\s\-.,]*(\d{2}|\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return utc(+m[3] < 100 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  if (/^\d{5}$/.test(t) && +t > 40000 && +t < 60000) return new Date(Date.UTC(1899, 11, 30) + +t * 86400000); // a date stored as an Excel number
  return null;
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const PRIORITY: Record<string, Priority> = { low: "LOW", medium: "MEDIUM", normal: "MEDIUM", high: "HIGH", urgent: "URGENT", critical: "URGENT" };

export function parseSchedule(rows: Raw[], projectStart: Date | null): { tasks: ScheduleTask[]; errors: { row: number; message: string }[] } {
  const errors: { row: number; message: string }[] = [];
  const tasks: ScheduleTask[] = [];
  if (!rows.length) return { tasks, errors: [{ row: 0, message: "The file has no rows." }] };
  if (rows.length > MAX_SCHEDULE_ROWS) return { tasks, errors: [{ row: 0, message: `Too many rows (${rows.length}). Upload up to ${MAX_SCHEDULE_ROWS} tasks at a time.` }] };
  const col = columns(Object.keys(rows[0]));
  if (!col.name) return { tasks, errors: [{ row: 1, message: "There is no “Task” column. Use the template: the first row must be the column names." }] };
  const get = (r: Raw, f: string) => (col[f] ? (r[col[f]!] ?? "").trim() : "");
  const whole = (v: string) => (/^\d+(\.0+)?$/.test(v) ? Math.round(+v) : null);

  rows.forEach((r, i) => {
    const row = i + 2; // row 1 is the header
    const err = (message: string) => errors.push({ row, message });
    const name = get(r, "name");
    if (!name) { if (Object.values(r).some((v) => v.trim())) err("the Task name is empty"); return; }
    const t: ScheduleTask = { row, sl: get(r, "sl") || String(i + 1), name: name.slice(0, 200), priority: "MEDIUM" };
    const text = (f: keyof ScheduleTask, v: string, max: number) => { if (v) (t[f] as string) = v.slice(0, max); };
    text("zone", get(r, "zone"), 120); text("trade", get(r, "trade"), 60); text("unit", get(r, "unit"), 20); text("details", get(r, "details"), 1000);
    const dep = get(r, "dependsOn"); if (dep) t.dependsOn = dep;
    const who = get(r, "assignee"); if (who) t.assignee = who.slice(0, 120);

    const hc = get(r, "headcount");
    if (hc) { const n = whole(hc); if (n === null || n > 500) err(`People needed “${hc}” must be a whole number from 0 to 500`); else t.headcount = n; }
    const q = get(r, "qty");
    if (q) { const n = Number(q.replace(/,/g, "")); if (!Number.isFinite(n) || n < 0 || n > 1e9) err(`Planned quantity “${q}” is not a valid number`); else t.qty = n; }
    const pr = get(r, "priority");
    if (pr) { const p = PRIORITY[pr.toLowerCase()]; if (!p) err(`Priority “${pr}” must be Low, Medium, High or Urgent`); else t.priority = p; }

    // dates: real dates win; otherwise day numbers counted from the project start (day 1 = the start date)
    const s = get(r, "start"), d = get(r, "due"), sd = get(r, "startDay"), ed = get(r, "endDay"), du = get(r, "duration");
    if (s) { const x = parseDay(s); if (!x) err(`Start “${s}” is not a date (use for example 05-11-2026)`); else t.start = x; }
    if (d) { const x = parseDay(d); if (!x) err(`Due “${d}” is not a date (use for example 05-11-2026)`); else t.due = x; }
    if (!t.start && !t.due && (sd || ed)) {
      if (!projectStart) err("this project has no start date yet, so day numbers cannot be turned into dates. Set the project's start date, or use dates");
      else {
        const a = whole(sd), b = whole(ed), n = whole(du);
        if (sd && (a === null || a < 1 || a > 730)) err(`Start day “${sd}” must be a day number from 1`);
        else if (ed && (b === null || b < 1 || b > 730)) err(`End day “${ed}” must be a day number from 1`);
        else {
          const first = a ?? b, last = b ?? (a !== null && n ? a + n - 1 : a);
          if (first !== null && last !== null) { t.start = addDays(projectStart, first - 1); t.due = addDays(projectStart, last - 1); }
        }
      }
    } else if (!t.start && !t.due && du && !sd && !ed) err("add the dates: Start and Due, or Start day and End day");
    if (!t.start && !t.due && !errors.some((e) => e.row === row)) err("add the dates: Start and Due, or Start day and End day");
    if (t.start && !t.due) t.due = t.start;
    if (t.due && !t.start) t.start = t.due;
    if (t.start && t.due && t.due < t.start) err("the Due date is before the Start date");
    for (const x of [t.start, t.due]) if (x && (x.getUTCFullYear() < 2000 || x.getUTCFullYear() > 2100)) err("a date is not sensible (the year must be between 2000 and 2100)");
    tasks.push(t);
  });

  // "Depends on" is the Sl No (or the exact name) of a task ABOVE it in the file
  tasks.forEach((t, i) => {
    if (!t.dependsOn) return;
    const earlier = tasks.slice(0, i);
    const hit = earlier.find((x) => x.sl.toLowerCase() === t.dependsOn!.toLowerCase()) ?? earlier.find((x) => x.name.toLowerCase() === t.dependsOn!.toLowerCase());
    if (!hit) errors.push({ row: t.row, message: `“Depends on ${t.dependsOn}” does not match a task above this row (use its Sl No or its exact name)` });
  });
  return { tasks, errors: errors.sort((a, b) => a.row - b.row) };
}

// ───────────────────────── the materials the schedule needs ─────────────────────────
export type MaterialLine = { row: number; description: string; qty: number; unit?: string; neededBy: Date; forWork?: string; note?: string };
const MATERIAL_ALIASES: Record<string, string[]> = {
  name: ["material", "materialname", "item", "description", "name"],
  qty: ["quantity", "qty", "plannedquantity"],
  unit: ["unit", "uom"],
  neededOn: ["neededon", "neededby", "needby", "needbydate", "neededdate", "requiredon", "requiredby", "date", "dueon"],
  neededDay: ["neededday", "needbyday", "dayneeded", "requiredday", "day", "needday"],
  forWork: ["forwork", "work", "task", "activity", "usedfor", "for"],
  note: ["note", "notes", "remarks", "details"],
};

/** The second sheet of the schedule file: which material, how much, and on which day it must be on site. Same all-or-nothing checking. */
export function parseMaterialNeeds(rows: Raw[], projectStart: Date | null, tasks: ScheduleTask[] = []): { lines: MaterialLine[]; errors: { row: number; message: string }[] } {
  const lines: MaterialLine[] = [], errors: { row: number; message: string }[] = [];
  if (!rows.length) return { lines, errors };
  if (rows.length > MAX_SCHEDULE_ROWS) return { lines, errors: [{ row: 0, message: `Too many material rows (${rows.length}). Upload up to ${MAX_SCHEDULE_ROWS} at a time.` }] };
  const headers = Object.keys(rows[0]);
  const col: Record<string, string | undefined> = {};
  for (const [f, names] of Object.entries(MATERIAL_ALIASES)) for (const n of names) { const h = headers.find((x) => key(x) === n && !Object.values(col).includes(x)); if (h) { col[f] = h; break; } }
  if (!col.name) return { lines, errors: [{ row: 1, message: "Materials sheet: there is no “Material” column." }] };
  const get = (r: Raw, f: string) => (col[f] ? (r[col[f]!] ?? "").trim() : "");
  rows.forEach((r, i) => {
    const row = i + 2;
    const err = (m: string) => errors.push({ row, message: `Materials sheet: ${m}` });
    const description = get(r, "name");
    if (!description) { if (Object.values(r).some((v) => v.trim())) err("the Material name is empty"); return; }
    const q = Number(get(r, "qty").replace(/,/g, ""));
    if (!get(r, "qty") || !Number.isFinite(q) || q <= 0 || q > 1e9) return err(`“${description}”: Quantity must be a number above 0`);
    let neededBy: Date | null = null;
    const on = get(r, "neededOn"), dayNo = get(r, "neededDay");
    if (on) { neededBy = parseDay(on); if (!neededBy) return err(`“${description}”: Needed on “${on}” is not a date (use for example 05-11-2026)`); }
    else if (dayNo) {
      if (!projectStart) return err(`“${description}”: this project has no start date yet, so a day number cannot be turned into a date`);
      const n = /^\d+(\.0+)?$/.test(dayNo) ? Math.round(+dayNo) : 0;
      if (n < 1 || n > 730) return err(`“${description}”: Needed day “${dayNo}” must be a day number from 1`);
      neededBy = addDays(projectStart, n - 1);
    } else return err(`“${description}”: say when it is needed (Needed on, or Needed day)`);
    if (neededBy.getUTCFullYear() < 2000 || neededBy.getUTCFullYear() > 2100) return err(`“${description}”: the date is not sensible`);
    const w = get(r, "forWork");
    let forWork = w || undefined;
    if (w) { const hit = tasks.find((t) => t.sl.toLowerCase() === w.toLowerCase()) ?? tasks.find((t) => t.name.toLowerCase() === w.toLowerCase()); if (hit) forWork = hit.name; }
    lines.push({ row, description: description.slice(0, 200), qty: q, unit: get(r, "unit").slice(0, 20) || undefined, neededBy, forWork: forWork?.slice(0, 200), note: get(r, "note").slice(0, 500) || undefined });
  });
  return { lines, errors };
}

/**
 * Rows copied from Excel and pasted: one line per row, cells separated by tabs (or commas when there is no tab). The first line is the
 * column names. Empty lines are skipped.
 */
export function pastedRows(text: string): Raw[] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const cells = (l: string) => l.split(sep).map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
  const header = cells(lines[0]);
  return lines.slice(1).map((l) => { const v = cells(l); return Object.fromEntries(header.map((h, i) => [h, v[i] ?? ""])); });
}
