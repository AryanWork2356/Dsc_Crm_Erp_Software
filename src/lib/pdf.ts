import "server-only";
import PDFDocument from "pdfkit";
import { db } from "./db";

/**
 * Generic business-document PDF (quotation, BOQ, PO, invoice, payslip…).
 * Uses built-in Helvetica, which has no ₹ glyph, so amounts print as "Rs. 1,23,456.00".
 */

export type PdfColumn = { header: string; width: number; align?: "left" | "right" | "center" };
export type PdfRow = { cells: string[]; kind?: "group" | "normal" | "subtotal" };
export type PdfDocSpec = {
  title: string; // "QUOTATION"
  number: string;
  meta: [string, string][]; // right-hand block under the title
  party?: { heading: string; lines: string[] };
  party2?: { heading: string; lines: string[] };
  columns: PdfColumn[];
  rows: PdfRow[];
  totals?: [string, string][]; // last entry rendered bold
  amountWords?: string;
  sections?: { heading: string; body: string }[];
  signatory?: string;
  note?: string; // small italic line under the table
};

export type CompanyInfo = {
  name: string; address?: string | null; phone?: string | null; email?: string | null; website?: string | null;
  gstin?: string | null; pan?: string | null; bankName?: string | null; bankAccountNo?: string | null; bankIfsc?: string | null; bankBranch?: string | null;
};

export async function loadCompany(companyId: string): Promise<CompanyInfo> {
  const s = await db.companySettings.findUnique({ where: { companyId }, include: { company: true } });
  return {
    name: s?.legalName ?? s?.company.name ?? "Company", address: s?.address, phone: s?.phone, email: s?.email, website: s?.website,
    gstin: s?.gstin, pan: s?.pan, bankName: s?.bankName, bankAccountNo: s?.bankAccountNo, bankIfsc: s?.bankIfsc, bankBranch: s?.bankBranch,
  };
}

export const inr = (n: number | string | { toString(): string } | null | undefined) =>
  "Rs. " + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n?.toString() ?? 0));

const NAVY = "#14244a";
const GREY = "#64748b";
const LINE = "#e2e8f0";

export function renderPdf(company: CompanyInfo, spec: PdfDocSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `${spec.title} ${spec.number}`, Author: company.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 40;
    const right = doc.page.width - 40;
    const width = right - left;
    const bottomLimit = () => doc.page.height - 60;

    // ── header
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(18).text(company.name, left, 40, { width: width * 0.6 });
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY);
    const contact = [company.address, [company.phone, company.email].filter(Boolean).join("  |  "), company.website, [company.gstin && `GSTIN: ${company.gstin}`, company.pan && `PAN: ${company.pan}`].filter(Boolean).join("   ")].filter(Boolean);
    contact.forEach((l) => doc.text(l as string, { width: width * 0.6 }));
    const headerBottom = doc.y;

    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(20).text(spec.title, left + width * 0.55, 40, { width: width * 0.45, align: "right" });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(spec.number, { width: width * 0.45, align: "right", continued: false });
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY);
    for (const [k, v] of spec.meta) doc.text(`${k}: ${v}`, left + width * 0.55, doc.y, { width: width * 0.45, align: "right" });

    let y = Math.max(headerBottom, doc.y) + 12;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(NAVY).lineWidth(1.5).stroke();
    y += 12;

    // ── parties
    const parties = [spec.party, spec.party2].filter(Boolean) as { heading: string; lines: string[] }[];
    if (parties.length) {
      const colW = width / parties.length - 10;
      let maxY = y;
      parties.forEach((p, i) => {
        const x = left + i * (colW + 20);
        doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY).text(p.heading.toUpperCase(), x, y, { width: colW });
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(p.lines[0] ?? "", x, doc.y + 2, { width: colW });
        doc.font("Helvetica").fontSize(9).fillColor("#334155");
        p.lines.slice(1).forEach((l) => doc.text(l, x, doc.y, { width: colW }));
        maxY = Math.max(maxY, doc.y);
      });
      y = maxY + 14;
    }

    // ── table
    const totalW = spec.columns.reduce((s, c) => s + c.width, 0);
    const scale = width / totalW;
    const cols = spec.columns.map((c) => ({ ...c, w: c.width * scale }));
    const pad = 5;

    const drawHeader = (yy: number) => {
      doc.rect(left, yy, width, 20).fill(NAVY);
      let x = left;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff");
      cols.forEach((c) => {
        doc.text(c.header, x + pad, yy + 6, { width: c.w - pad * 2, align: c.align ?? "left", lineBreak: false });
        x += c.w;
      });
      return yy + 20;
    };

    y = drawHeader(y);
    for (const row of spec.rows) {
      doc.font(row.kind === "group" || row.kind === "subtotal" ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      const heights = row.kind === "group"
        ? [14]
        : row.cells.map((t, i) => doc.heightOfString(t, { width: cols[i].w - pad * 2 }));
      const h = Math.max(...heights) + 10;
      if (y + h > bottomLimit()) {
        doc.addPage();
        y = drawHeader(40);
      }
      if (row.kind === "group") {
        doc.rect(left, y, width, h).fill("#eef3fb");
        doc.fillColor(NAVY).text(row.cells[0], left + pad, y + 5, { width: width - pad * 2 });
      } else {
        if (row.kind === "subtotal") doc.rect(left, y, width, h).fill("#f8fafc");
        let x = left;
        doc.fillColor("#0f172a");
        row.cells.forEach((t, i) => {
          doc.text(t, x + pad, y + 5, { width: cols[i].w - pad * 2, align: cols[i].align ?? "left" });
          x += cols[i].w;
        });
      }
      doc.moveTo(left, y + h).lineTo(right, y + h).strokeColor(LINE).lineWidth(0.5).stroke();
      y += h;
    }

    // ── totals
    if (spec.totals?.length) {
      const boxW = 230;
      const need = spec.totals.length * 18 + 30;
      if (y + need > bottomLimit()) {
        doc.addPage();
        y = 40;
      }
      y += 10;
      spec.totals.forEach(([k, v], i) => {
        const last = i === spec.totals!.length - 1;
        if (last) doc.rect(right - boxW, y - 3, boxW, 20).fill(NAVY);
        doc.font(last ? "Helvetica-Bold" : "Helvetica").fontSize(last ? 10 : 9).fillColor(last ? "#ffffff" : "#334155");
        doc.text(k, right - boxW + 8, y + (last ? 2 : 0), { width: boxW * 0.5, lineBreak: false });
        doc.text(v, right - boxW + boxW * 0.4, y + (last ? 2 : 0), { width: boxW * 0.6 - 8, align: "right", lineBreak: false });
        y += last ? 24 : 16;
      });
      if (spec.amountWords) {
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(GREY).text(spec.amountWords, left, y, { width });
        y = doc.y + 6;
      }
    }
    if (spec.note) {
      doc.font("Helvetica-Oblique").fontSize(8).fillColor(GREY).text(spec.note, left, y + 2, { width });
      y = doc.y + 6;
    }

    // ── sections (terms, bank, notes)
    for (const s of spec.sections ?? []) {
      if (!s.body.trim()) continue;
      doc.font("Helvetica").fontSize(8.5);
      const h = doc.heightOfString(s.body, { width }) + 24;
      if (y + Math.min(h, 80) > bottomLimit()) {
        doc.addPage();
        y = 40;
      }
      doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text(s.heading, left, y + 8, { width });
      doc.font("Helvetica").fontSize(8.5).fillColor("#334155").text(s.body, left, doc.y + 2, { width });
      y = doc.y + 4;
    }

    if (spec.signatory) {
      if (y + 70 > bottomLimit()) {
        doc.addPage();
        y = 40;
      }
      doc.font("Helvetica").fontSize(9).fillColor("#334155").text(`For ${spec.signatory}`, right - 200, y + 24, { width: 200, align: "right" });
      doc.moveTo(right - 160, y + 70).lineTo(right, y + 70).strokeColor(GREY).lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor(GREY).text("Authorised signatory", right - 200, y + 74, { width: 200, align: "right" });
    }

    // ── footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(7.5).fillColor(GREY);
      doc.text(`${company.name}  ·  ${spec.title} ${spec.number}  ·  Page ${i + 1} of ${range.count}`, left, doc.page.height - 32, { width, align: "center", lineBreak: false });
    }
    doc.end();
  });
}

export function pdfResponse(buf: Buffer, filename: string, inline = true) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function bankSection(c: CompanyInfo): { heading: string; body: string } | null {
  if (!c.bankName && !c.bankAccountNo) return null;
  return {
    heading: "Bank details",
    body: [c.bankName && `Bank: ${c.bankName}`, c.bankBranch && `Branch: ${c.bankBranch}`, c.bankAccountNo && `A/c No: ${c.bankAccountNo}`, c.bankIfsc && `IFSC: ${c.bankIfsc}`].filter(Boolean).join("   "),
  };
}
