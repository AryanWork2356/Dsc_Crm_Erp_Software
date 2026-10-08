import ExcelJS from "exceljs";
import { getCtx } from "@/lib/auth";
import { BOQ_CATEGORIES } from "@/lib/enums";

export async function GET() {
  const c = await getCtx();
  if (!c || !c.can("boq:view")) return new Response("Forbidden", { status: 403 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ");
  const hr = ws.addRow(["Category", "Item", "Specification", "Unit", "Quantity", "Material Cost", "Labour Cost", "Other Cost", "Selling Rate"]);
  hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14244A" } };
  ws.addRow(["CARPENTRY", "Modular kitchen base unit", "18mm BWP ply, laminate finish", "rft", 12, 3200, 900, 150, 5800]);
  ws.addRow(["FALSE_CEILING", "Gypsum false ceiling", "12.5mm board on GI channel", "sqft", 450, 55, 30, 5, 120]);
  ws.addRow([]);
  ws.addRow(["Categories: " + BOQ_CATEGORIES.join(", ")]).font = { italic: true, color: { argb: "FF64748B" } };
  ws.addRow(["Costs are per unit. Cost columns are ignored for users without cost access."]).font = { italic: true, color: { argb: "FF64748B" } };
  ws.columns.forEach((col, i) => { col.width = i === 1 ? 36 : i === 2 ? 34 : 15; });
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="boq-template.xlsx"' },
  });
}
