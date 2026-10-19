import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { amountInWords, computeTotals } from "@/lib/money";
import { loadCompany, type CompanyInfo } from "@/lib/pdf";
import { placeLabel, splitTax } from "@/lib/gst";
import { LOGO_PNG_BASE64 } from "@/lib/logo";
import { BOQ_CATEGORIES } from "@/lib/enums";
import { formatDate, humanize, num } from "@/lib/utils";

const NAVY = "FF14244A", GOLD = "FFC8872E", CREAM = "FFFAF6EE", PALE = "FFEEF3FB", GREY = "FF64748B", INK = "FF0F172A";
const FONT = "Calibri";
const MONEY = "#,##0.00";
const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const line = (argb = "FFCBD5E1") => ({ style: "thin" as const, color: { argb } });
const box = { top: line(), bottom: line(), left: line(), right: line() };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** DSC letterhead: logo, company name on a navy band, contact line, GSTIN/PAN, gold rule. Returns the next row to use. */
function letterhead(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, c: CompanyInfo, lastCol: number): number {
  const last = ws.getColumn(lastCol).letter;
  for (let r = 1; r <= 4; r++) {
    ws.mergeCells(`B${r}:${last}${r}`);
    for (let k = 1; k <= lastCol; k++) ws.getCell(r, k).fill = solid(NAVY);
  }
  ws.getCell("B1").value = c.name;
  ws.getCell("B1").font = { name: FONT, size: 20, bold: true, color: { argb: CREAM } };
  ws.getCell("B2").value = c.address ?? "";
  ws.getCell("B3").value = [c.phone && `Tel: ${c.phone}`, c.email, c.website].filter(Boolean).join("   |   ");
  ws.getCell("B4").value = [c.gstin && `GSTIN: ${c.gstin}`, c.pan && `PAN: ${c.pan}`].filter(Boolean).join("     ");
  for (const r of [2, 3, 4]) ws.getCell(`B${r}`).font = { name: FONT, size: 10, color: { argb: "FFD7DFEF" } };
  for (let r = 1; r <= 4; r++) ws.getCell(`B${r}`).alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 16;
  ws.getRow(4).height = 16;
  ws.addImage(wb.addImage({ base64: LOGO_PNG_BASE64, extension: "png" }), { tl: { col: 0.1, row: 0.12 }, ext: { width: 62, height: 62 } });
  ws.getRow(5).height = 4;
  for (let k = 1; k <= lastCol; k++) ws.getCell(5, k).fill = solid(GOLD);
  return 7;
}

function headerRow(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (cell, n) => {
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = solid(NAVY);
    cell.alignment = { vertical: "middle", horizontal: n <= 2 ? "left" : "center", wrapText: true };
  });
  row.height = 22;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (!c || !c.can("quotations:view")) return new Response("Forbidden", { status: 403 });
  const q = await db.quotation.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { client: true, items: { orderBy: { sortOrder: "asc" } } } });
  if (!q) return new Response("Not found", { status: 404 });
  if (c.role === "CLIENT" || c.role === "VENDOR") return new Response("Forbidden", { status: 403 }); // clients get the PDF from their portal
  if (c.role === "SALES" && q.preparedById !== c.userId) {
    const own = q.leadId ? await db.lead.findFirst({ where: { id: q.leadId, assignedToId: c.userId }, select: { id: true } }) : null;
    if (!own) return new Response("Forbidden", { status: 403 });
  }

  const company = await loadCompany(c.companyId);
  const t = computeTotals(q.items.map((i) => ({ quantity: num(i.quantity), rate: num(i.rate), taxPercent: num(i.taxPercent) })), { pct: num(q.discountPct) });
  const gst = splitTax(q.items.map((i, n) => ({ amount: t.lines[n].amount, taxPercent: num(i.taxPercent) })), { companyGstin: company.gstin, partyGstin: q.client.gstin, placeOfSupply: q.placeOfSupply, discount: t.discount, storedTax: t.tax });

  const wb = new ExcelJS.Workbook();
  wb.creator = company.name;
  wb.title = `Quotation ${q.number}`;
  const page: Partial<ExcelJS.PageSetup> = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 } };
  const widths = [{ width: 6 }, { width: 52 }, { width: 9 }, { width: 11 }, { width: 14 }, { width: 8 }, { width: 17 }];

  // ───────── "BOQ details" (built first so the summary can point at its category sub-totals) ─────────
  const det = wb.addWorksheet("BOQ details", { views: [{ showGridLines: false }] });
  det.columns = widths;
  let r = letterhead(wb, det, company, 7);
  det.mergeCells(`A${r}:G${r}`);
  det.getCell(`A${r}`).value = `BOQ details – ${q.title ?? q.number}  (${q.number})`;
  det.getCell(`A${r}`).font = { name: FONT, size: 13, bold: true, color: { argb: NAVY } };
  r += 2;
  det.getRow(r).values = ["Sl.", "Description", "Unit", "Quantity", "Rate (₹)", "GST %", "Amount (₹)"];
  headerRow(det.getRow(r));
  const headRow = r++;
  const subtotals = new Map<string, { addr: string; value: number }>();
  let sl = 0;
  for (const cat of BOQ_CATEGORIES) {
    const rows = q.items.map((it, k) => ({ it, k })).filter((x) => x.it.category === cat);
    if (!rows.length) continue;
    det.mergeCells(`A${r}:G${r}`);
    det.getCell(`A${r}`).value = humanize(cat);
    det.getCell(`A${r}`).font = { name: FONT, bold: true, color: { argb: NAVY } };
    det.getCell(`A${r}`).fill = solid(PALE);
    r++;
    const start = r;
    for (const { it, k } of rows) {
      det.getRow(r).values = [++sl, it.description, it.unit, num(it.quantity), num(it.rate), num(it.taxPercent), { formula: `ROUND(D${r}*E${r},2)`, result: t.lines[k].amount }];
      det.getRow(r).eachCell((cell, cn) => {
        cell.border = box;
        cell.font = { name: FONT, size: 10 };
        cell.alignment = { vertical: "top", wrapText: cn === 2, horizontal: cn === 2 ? "left" : cn === 1 || cn === 3 ? "center" : "right" };
      });
      det.getCell(`D${r}`).numFmt = "#,##0.###";
      det.getCell(`E${r}`).numFmt = MONEY;
      det.getCell(`F${r}`).numFmt = "0.##";
      det.getCell(`G${r}`).numFmt = MONEY;
      r++;
    }
    const sub = r2(rows.reduce((s, x) => s + t.lines[x.k].amount, 0));
    det.getCell(`F${r}`).value = "Sub-total";
    det.getCell(`F${r}`).alignment = { horizontal: "right" };
    det.getCell(`G${r}`).value = { formula: `SUM(G${start}:G${r - 1})`, result: sub };
    det.getCell(`G${r}`).numFmt = MONEY;
    for (let cn = 6; cn <= 7; cn++) { det.getCell(r, cn).font = { name: FONT, bold: true, size: 10 }; det.getCell(r, cn).border = box; }
    subtotals.set(cat, { addr: `'BOQ details'!G${r}`, value: sub });
    r += 2;
  }
  det.views = [{ state: "frozen", ySplit: headRow, showGridLines: false }];
  det.pageSetup = { ...page, printTitlesRow: `${headRow}:${headRow}` };
  det.headerFooter.oddFooter = `&L&8${company.name}&C&8Page &P of &N&R&8${q.number}`;

  // ───────── "Quotation" – the letter itself ─────────
  const ws = wb.addWorksheet("Quotation", { views: [{ showGridLines: false }] });
  ws.columns = widths;
  r = letterhead(wb, ws, company, 7);
  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = "QUOTATION";
  ws.getCell(`A${r}`).font = { name: FONT, size: 20, bold: true, color: { argb: NAVY } };
  ws.mergeCells(`F${r}:G${r}`);
  ws.getCell(`F${r}`).value = q.number + (q.revision > 1 ? ` (Rev ${q.revision})` : "");
  ws.getCell(`F${r}`).font = { name: FONT, size: 12, bold: true };
  ws.getCell(`F${r}`).alignment = { horizontal: "right", vertical: "middle" };
  r += 2;
  const info: [string, string][] = [["To", q.client.companyName ?? q.client.name]];
  if (q.client.companyName) info.push(["Attention", q.client.name]);
  if (q.client.address) info.push(["Address", q.client.address]);
  if (q.client.gstin) info.push(["Client GSTIN", q.client.gstin]);
  info.push(["Subject", q.title ?? ""], ["Date", formatDate(q.date)]);
  if (q.validUntil) info.push(["Valid until", formatDate(q.validUntil)]);
  info.push(["Place of supply", placeLabel(gst.supplyState)]);
  for (const [k, v] of info) {
    ws.mergeCells(`A${r}:B${r}`);
    ws.mergeCells(`C${r}:G${r}`);
    ws.getCell(`A${r}`).value = k;
    ws.getCell(`C${r}`).value = v;
    ws.getCell(`A${r}`).font = { name: FONT, bold: true, size: 10, color: { argb: GREY } };
    ws.getCell(`C${r}`).font = { name: FONT, size: 10 };
    ws.getCell(`C${r}`).alignment = { wrapText: true, vertical: "top" };
    r++;
  }
  r++;
  ws.mergeCells(`A${r}:G${r}`);
  ws.getCell(`A${r}`).value = "SUMMARY OF WORK";
  ws.getCell(`A${r}`).font = { name: FONT, size: 12, bold: true, color: { argb: NAVY } };
  r++;
  ws.getRow(r).values = ["Sl.", "Work category", "", "", "", "", "Amount (₹)"];
  ws.mergeCells(`B${r}:F${r}`);
  headerRow(ws.getRow(r));
  r++;
  const first = r;
  let k = 0;
  for (const [cat, cell] of subtotals) {
    ws.getRow(r).values = [++k, humanize(cat), "", "", "", "", { formula: cell.addr, result: cell.value }];
    ws.mergeCells(`B${r}:F${r}`);
    for (let cn = 1; cn <= 7; cn++) { ws.getCell(r, cn).border = box; ws.getCell(r, cn).font = { name: FONT, size: 10 }; }
    ws.getCell(`A${r}`).alignment = { horizontal: "center" };
    ws.getCell(`G${r}`).numFmt = MONEY;
    r++;
  }
  const lastCat = r - 1;
  const total = (label: string, value: number | { formula: string; result: number }, bold = false, fill?: string) => {
    ws.mergeCells(`B${r}:F${r}`);
    ws.getCell(`B${r}`).value = label;
    ws.getCell(`B${r}`).alignment = { horizontal: "right" };
    ws.getCell(`G${r}`).value = value;
    ws.getCell(`G${r}`).numFmt = MONEY;
    for (let cn = 2; cn <= 7; cn++) {
      const x = ws.getCell(r, cn);
      x.font = { name: FONT, size: 10, bold, color: { argb: fill ? "FFFFFFFF" : INK } };
      x.border = box;
      if (fill) x.fill = solid(fill);
    }
    return r++;
  };
  const subRow = total("Sub-total", { formula: `SUM(G${first}:G${lastCat})`, result: t.subtotal }, true);
  const discRow = t.discount > 0 ? total(`Discount (${num(q.discountPct)}%)`, { formula: `-ROUND(G${subRow}*${num(q.discountPct)}/100,2)`, result: -t.discount }) : 0;
  const taxStart = r;
  for (const x of gst.rates) {
    if (gst.type === "INTER") total(`IGST @ ${x.rate}%`, x.igst);
    else { total(`CGST @ ${x.rate / 2}%`, x.cgst); total(`SGST @ ${x.rate / 2}%`, x.sgst); }
  }
  total("GRAND TOTAL", { formula: `G${subRow}${discRow ? `+G${discRow}` : ""}${r > taxStart ? `+SUM(G${taxStart}:G${r - 1})` : ""}`, result: t.total }, true, NAVY);
  r++;
  ws.mergeCells(`A${r}:G${r}`);
  ws.getCell(`A${r}`).value = `Amount in words: ${amountInWords(t.total)}`;
  ws.getCell(`A${r}`).font = { name: FONT, italic: true, size: 10, color: { argb: GREY } };
  ws.getCell(`A${r}`).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(r).height = 30;
  r += 2;
  const block = (title: string, body?: string | null) => {
    if (!body?.trim()) return;
    ws.mergeCells(`A${r}:G${r}`);
    ws.getCell(`A${r}`).value = title;
    ws.getCell(`A${r}`).font = { name: FONT, bold: true, size: 11, color: { argb: NAVY } };
    r++;
    ws.mergeCells(`A${r}:G${r}`);
    ws.getCell(`A${r}`).value = body;
    ws.getCell(`A${r}`).font = { name: FONT, size: 10 };
    ws.getCell(`A${r}`).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = Math.max(18, Math.ceil(body.length / 100) * 14 + body.split("\n").length * 2);
    r += 2;
  };
  block("Payment terms", q.paymentTerms);
  block("Terms & conditions", q.terms);
  block("Notes", q.notes);
  block("Bank details", [company.bankName && `Bank: ${company.bankName}`, company.bankBranch && `Branch: ${company.bankBranch}`, company.bankAccountNo && `A/c No: ${company.bankAccountNo}`, company.bankIfsc && `IFSC: ${company.bankIfsc}`].filter(Boolean).join("     "));
  r++;
  ws.mergeCells(`E${r}:G${r}`);
  ws.getCell(`E${r}`).value = `For ${company.name}`;
  ws.getCell(`E${r}`).font = { name: FONT, size: 10 };
  ws.getCell(`E${r}`).alignment = { horizontal: "right" };
  r += 4;
  ws.mergeCells(`E${r}:G${r}`);
  ws.getCell(`E${r}`).value = "Authorised signatory";
  ws.getCell(`E${r}`).font = { name: FONT, size: 9, color: { argb: GREY } };
  ws.getCell(`E${r}`).alignment = { horizontal: "right" };
  ws.getCell(`E${r}`).border = { top: line(GREY) };
  ws.pageSetup = page;
  ws.headerFooter.oddFooter = `&L&8${company.name}&C&8Page &P of &N&R&8${q.number}`;

  // the letter opens first, the BOQ details second
  (ws as unknown as { orderNo: number }).orderNo = 0; // exceljs sorts sheets by this when saving
  (det as unknown as { orderNo: number }).orderNo = 1;
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];

  await audit(c, { action: "EXPORT", entityType: "Quotation", entityId: id, summary: `Exported quotation ${q.number} to Excel` });
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${q.number}.xlsx"`, "Cache-Control": "private, no-store" },
  });
}
