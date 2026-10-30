import "server-only";
import ExcelJS from "exceljs";
import sample from "./schedule-sample.json";

/** The Excel file people download, fill and upload: the work (a 25-day example to copy from), the materials it needs, and how to fill both. */
export async function scheduleTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Schedule");
  ws.addRow(sample.header);
  for (const r of sample.rows) ws.addRow(r);
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A52" } };
  [7, 42, 26, 14, 14, 22, 11, 10, 16, 10, 12, 10, 44].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const ms = wb.addWorksheet("Materials");
  ms.addRow(sample.materialsHeader);
  for (const r of sample.materials) ms.addRow(r);
  ms.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ms.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A52" } };
  [36, 10, 10, 12, 10, 36].forEach((w, i) => (ms.getColumn(i + 1).width = w));
  ms.views = [{ state: "frozen", ySplit: 1 }];
  const how = wb.addWorksheet("How to fill");
  const lines = [
    "HOW TO FILL THE SCHEDULE",
    "",
    "One row for each piece of work. Delete the example rows and type your own. Keep the first row (the column names) as it is.",
    "Task: what is to be done. This is the only box that must always be filled.",
    "Area / zone: where on the site (Hall, Kitchen, Whole flat).  Trade: who does it (Carpenter, Electrician, Painter, Civil).  People needed: how many.",
    "Assigned to: the person in charge of this work, as their name or login appears in the app (a supervisor, an engineer, or a worker with a login). They see it in Today's Plan or on their phone. Leave empty if not decided.",
    "Dates: either type Start and Due as real dates (for example 05-11-2026), OR use Start day and End day: day 1 is the day the project starts, day 25 is 24 days later. Day numbers need the project's start date to be set first.",
    "Depends on: the Sl No of a task ABOVE this row that must finish first (for example 8), or its exact name. Leave empty if it can start any time.",
    "Planned quantity and Unit: how much work there is (98, sqft). Priority: Low, Medium, High or Urgent.",
    "If a row is wrong, NOTHING is added and the app tells you which row and why. Fix that row and upload again.",
    "The first date you give a task becomes its committed date. Later changes need a reason and are recorded.",
    "",
    "THE MATERIALS SHEET",
    "One row for each material the work needs. Material, Quantity and Unit: what and how much. Needed day: the day it must be ON SITE (day 1 = project start), or use a column called Needed on with a real date.",
    "For work: the Sl No (or exact name) of the task it is for. Leave the Materials sheet empty, or delete it, if you do not want to list material now.",
    "The app does not ask you whether material arrived: it sees the purchase requests, orders and receipts and tells Procurement if something is not asked for or will be late.",
  ];
  lines.forEach((t, i) => { const c = how.getCell(i + 1, 1); c.value = t; if (i === 0) c.font = { bold: true, size: 13 }; c.alignment = { wrapText: true, vertical: "top" }; });
  how.getColumn(1).width = 120;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
