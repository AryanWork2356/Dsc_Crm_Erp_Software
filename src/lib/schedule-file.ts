import "server-only";
import ExcelJS from "exceljs";
import { UserError } from "./action";
import { readTable } from "./importer";
import type { Raw } from "./schedule-import";

const cell = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return "result" in v && v.result !== undefined ? String(v.result) : "text" in v ? String(v.text) : "richText" in v ? v.richText.map((x) => x.text).join("") : "";
  return String(v).trim();
};

function sheetRows(ws: ExcelJS.Worksheet): Raw[] {
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => { const vals: string[] = []; for (let c = 1; c <= row.cellCount; c++) vals.push(cell(row.getCell(c).value)); if (vals.some((v) => v)) grid.push(vals); });
  if (grid.length < 2) return [];
  const headers = grid[0].map((h) => h.trim());
  return grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** The schedule file: sheet 1 is the work, and a sheet called Materials (or with “material” in its name) is the materials the work needs. CSV has the work only. */
export async function readScheduleFile(file: File): Promise<{ work: Raw[]; materials: Raw[] }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) return { work: await readTable(file), materials: [] };
  if (!lower.endsWith(".xlsx")) throw new UserError("Only .xlsx and .csv files are supported. Download the template for the right layout.");
  if (file.size > 5 * 1024 * 1024) throw new UserError("File is too large (max 5 MB).");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as never); } catch { throw new UserError("That file couldn't be read as an Excel workbook."); }
  if (!wb.worksheets.length) throw new UserError("The workbook is empty.");
  const mat = wb.worksheets.find((w) => /material/i.test(w.name));
  const first = wb.worksheets.find((w) => w !== mat && !/how to|read me|instruction/i.test(w.name));
  return { work: first ? sheetRows(first) : [], materials: mat ? sheetRows(mat) : [] };
}
