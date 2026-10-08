import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCtx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { canRun, reportByKey, type Column } from "@/lib/reports";
import { parseFilters } from "@/lib/report-filters";
import { csvResponse } from "@/lib/list";
import { inr, loadCompany, pdfResponse, renderPdf } from "@/lib/pdf";
import { formatDate, num } from "@/lib/utils";

const text = (col: Column, v: unknown) => {
  if (v === null || v === undefined) return "";
  if (col.type === "money") return inr(v as number);
  if (col.type === "date") return formatDate(v as Date);
  if (col.type === "pct") return `${num(v as number).toFixed(1)}%`;
  return String(v);
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const c = await getCtx();
  const report = reportByKey(key);
  if (!c || !report || !canRun(c, report) || !c.can("reports:export")) return new Response("Forbidden", { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseFilters(sp);
  const res = await report.run(c, f);
  const format = sp.format === "xlsx" || sp.format === "pdf" ? sp.format : "csv";
  await audit(c, { action: "EXPORT", entityType: "Report", summary: `Exported ${report.title} (${format.toUpperCase()}, ${res.rows.length} rows)` });
  const rows = res.totals ? [...res.rows, res.totals] : res.rows;

  if (format === "csv") {
    return csvResponse(`${key}.csv`, res.columns.map((x) => x.label), rows.map((r) => res.columns.map((x) => (x.type === "money" || x.type === "number" || x.type === "pct" ? r[x.key] ?? "" : r[x.key] instanceof Date ? r[x.key] : r[x.key] ?? ""))));
  }
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(report.title.slice(0, 30));
    ws.addRow([report.title]).font = { bold: true, size: 13 };
    ws.addRow([`${f.fromStr} to ${f.toStr}`]).font = { color: { argb: "FF64748B" } };
    const hr = ws.addRow(res.columns.map((x) => x.label));
    hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14244A" } };
    for (const r of rows) ws.addRow(res.columns.map((x) => (r[x.key] === undefined ? null : r[x.key])));
    res.columns.forEach((x, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.max(12, Math.min(40, x.label.length + 6));
      if (x.type === "money") col.numFmt = '[$₹-4009]#,##,##0.00';
      if (x.type === "date") col.numFmt = "dd-mmm-yyyy";
      if (x.type === "pct") col.numFmt = '0.0"%"';
    });
    if (res.totals) ws.lastRow!.font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    return new Response(new Uint8Array(buf as ArrayBuffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${key}.xlsx"` } });
  }
  // PDF: landscape-friendly proportional columns
  const company = await loadCompany(c.companyId);
  const widths = res.columns.map((x) => (["money", "number", "pct", "date"].includes(x.type ?? "") ? 70 : 110));
  const buf = await renderPdf(company, {
    title: report.title.toUpperCase(), number: `${f.fromStr} → ${f.toStr}`, meta: [["Rows", String(res.rows.length)]],
    columns: res.columns.map((x, i) => ({ header: x.label, width: widths[i], align: ["money", "number", "pct"].includes(x.type ?? "") ? "right" : "left" })),
    rows: rows.slice(0, 600).map((r, idx) => ({ kind: res.totals && idx === rows.length - 1 ? "subtotal" : "normal", cells: res.columns.map((x) => text(x, r[x.key])) })),
    note: rows.length > 600 ? "Showing the first 600 rows. Use the Excel export for the full data." : undefined,
  });
  return pdfResponse(buf, `${key}.pdf`);
}
