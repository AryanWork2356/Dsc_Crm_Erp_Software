import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { num } from "@/lib/utils";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (!c || !c.can("boq:export")) return new Response("Forbidden", { status: 403 });
  const b = await db.boq.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!b) return new Response("Not found", { status: 404 });

  const costs = c.can("margins:view");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ");
  const headers = ["Category", "Item", "Specification", "Unit", "Quantity", ...(costs ? ["Material Cost", "Labour Cost", "Other Cost"] : []), "Selling Rate", ...(costs ? ["Estimated Cost"] : []), "Total"];
  ws.addRow([`${b.number} – ${b.title}`]).font = { bold: true, size: 13 };
  ws.addRow([]);
  const hr = ws.addRow(headers);
  hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14244A" } };
  for (const i of b.items) {
    ws.addRow([i.category, i.item, i.specification ?? "", i.unit, num(i.quantity), ...(costs ? [num(i.materialCost), num(i.labourCost), num(i.otherCost)] : []), num(i.sellingRate), ...(costs ? [num(i.estimatedCost)] : []), num(i.total)]);
  }
  const lastCol = headers.length;
  const total = ws.addRow([...Array(lastCol - 1).fill(""), { formula: `SUM(${ws.getColumn(lastCol).letter}4:${ws.getColumn(lastCol).letter}${3 + b.items.length})`, result: b.items.reduce((s, i) => s + num(i.total), 0) }]);
  total.font = { bold: true };
  ws.columns.forEach((col, idx) => { col.width = idx === 1 ? 40 : idx === 2 ? 30 : 14; });
  ws.getRow(3).alignment = { vertical: "middle" };

  await audit(c, { action: "EXPORT", entityType: "Boq", entityId: id, summary: `Exported BOQ ${b.number} to Excel` });
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${b.number}.xlsx"` },
  });
}
