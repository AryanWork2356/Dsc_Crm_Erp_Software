import "server-only";
import ExcelJS from "exceljs";

export const SHEET_MIMES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"];
export const isSheetMime = (mime: string) => SHEET_MIMES.includes(mime);

const MAX_CHARS = 60_000; // plenty for a bill; keeps a huge sheet from becoming a huge (slow, costly) request

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return cellText(o.result as ExcelJS.CellValue); // a formula: its value
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return String(o.text);
    if ("hyperlink" in o) return String(o.hyperlink);
    return "";
  }
  return String(v).replace(/\s+/g, " ").trim();
};

/**
 * A spreadsheet (.xlsx or .csv) as plain text, one line per row with " | " between cells and "## Sheet name" before each sheet,
 * so the AI sees the layout the way a person would. Hidden sheets are left out. Merged cells show their text once.
 */
export async function sheetToText(bytes: Buffer, mime: string): Promise<string> {
  if (mime === "text/csv") return bytes.toString("utf8").slice(0, MAX_CHARS);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const out: string[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state !== "visible") continue;
    out.push(`## ${ws.name}`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values as ExcelJS.CellValue[]).slice(1).map((v) => cellText(v));
      if (cells.some(Boolean)) out.push(cells.join(" | ").replace(/(\s\|\s)+$/g, ""));
    });
    if (out.join("\n").length > MAX_CHARS) break;
  }
  return out.join("\n").slice(0, MAX_CHARS);
}
