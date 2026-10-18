import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { amountInWords, computeTotals } from "@/lib/money";
import { bankSection, inr, loadCompany, pdfResponse, renderPdf, type PdfRow } from "@/lib/pdf";
import { BOQ_CATEGORIES } from "@/lib/enums";
import { formatDate, humanize, num } from "@/lib/utils";
import { placeLabel, splitTax, taxTotalRows } from "@/lib/gst";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (!c || !c.can("quotations:view")) return new Response("Forbidden", { status: 403 });
  const q = await db.quotation.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { client: true, items: { orderBy: { sortOrder: "asc" } } } });
  if (!q) return new Response("Not found", { status: 404 });
  // portal users: only their own client's quotations that have actually been sent to them
  if (c.role === "CLIENT" && (q.clientId !== c.clientId || !["SENT", "VIEWED", "NEGOTIATION", "ACCEPTED"].includes(q.status))) return new Response("Not found", { status: 404 });
  if (c.role === "VENDOR") return new Response("Forbidden", { status: 403 });
  if (c.role === "SALES" && q.preparedById !== c.userId) {
    const own = q.leadId ? await db.lead.findFirst({ where: { id: q.leadId, assignedToId: c.userId }, select: { id: true } }) : null;
    if (!own) return new Response("Forbidden", { status: 403 });
  }

  const company = await loadCompany(c.companyId);
  const t = computeTotals(q.items.map((i) => ({ quantity: num(i.quantity), rate: num(i.rate), taxPercent: num(i.taxPercent) })), { pct: num(q.discountPct) });
  const gst = splitTax(q.items.map((i, idx) => ({ amount: t.lines[idx].amount, taxPercent: num(i.taxPercent) })), { companyGstin: company.gstin, partyGstin: q.client.gstin, placeOfSupply: q.placeOfSupply, discount: t.discount, storedTax: t.tax });
  const rows: PdfRow[] = [];
  let n = 0;
  for (const cat of BOQ_CATEGORIES) {
    const group = q.items.map((it, idx) => ({ it, idx })).filter((x) => x.it.category === cat);
    if (!group.length) continue;
    rows.push({ kind: "group", cells: [humanize(cat)] });
    for (const { it, idx } of group) {
      rows.push({ cells: [String(++n), it.description, it.unit, String(num(it.quantity)), inr(it.rate), `${num(it.taxPercent)}%`, inr(t.lines[idx].amount)] });
    }
  }
  // amount per work category (before GST), like the summary page of DSC's quotations
  const byCat = new Map<string, number>();
  q.items.forEach((it, idx) => byCat.set(it.category, (byCat.get(it.category) ?? 0) + t.lines[idx].amount));
  const summaryRows = BOQ_CATEGORIES.filter((cat) => byCat.has(cat)).map((cat) => [humanize(cat), inr(byCat.get(cat)!)] as [string, string]);
  const sections = [
    q.paymentTerms ? { heading: "Payment terms", body: q.paymentTerms } : null,
    q.terms ? { heading: "Terms & conditions", body: q.terms } : null,
    q.notes ? { heading: "Notes", body: q.notes } : null,
    bankSection(company),
  ].filter(Boolean) as { heading: string; body: string }[];

  const buf = await renderPdf(company, {
    title: "QUOTATION",
    number: `${q.number}${q.revision > 1 ? ` (Rev ${q.revision})` : ""}`,
    meta: [["Date", formatDate(q.date)], ["Place of supply", placeLabel(gst.supplyState)], ...(q.validUntil ? [["Valid until", formatDate(q.validUntil)] as [string, string]] : [])],
    party: { heading: "Quotation for", lines: [q.client.companyName ?? q.client.name, q.client.companyName ? `Attn: ${q.client.name}` : "", q.client.address ?? "", q.client.gstin ? `GSTIN: ${q.client.gstin}` : ""].filter(Boolean) as string[] },
    party2: q.title ? { heading: "Project / scope", lines: [q.title] } : undefined,
    columns: [
      { header: "#", width: 22 }, { header: "Description", width: 230 }, { header: "Unit", width: 38 }, { header: "Qty", width: 42, align: "right" },
      { header: "Rate", width: 78, align: "right" }, { header: "GST", width: 34, align: "right" }, { header: "Amount", width: 86, align: "right" },
    ],
    rows,
    summary: summaryRows.length > 1 ? { heading: "Summary of work", rows: summaryRows } : undefined,
    totals: [
      ["Subtotal", inr(t.subtotal)],
      ...(t.discount > 0 ? [[`Discount (${num(q.discountPct)}%)`, `- ${inr(t.discount)}`] as [string, string]] : []),
      ...(gst.rates.length ? taxTotalRows(gst, inr) : ([["GST", inr(t.tax)]] as [string, string][])),
      ["Total", inr(t.total)],
    ],
    amountWords: amountInWords(t.total),
    sections,
    signatory: company.name,
  });
  return pdfResponse(buf, `${q.number}.pdf`);
}
