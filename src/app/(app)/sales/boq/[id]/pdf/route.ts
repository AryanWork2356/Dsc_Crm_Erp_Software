import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { BOQ_CATEGORIES } from "@/lib/enums";
import { inr, loadCompany, pdfResponse, renderPdf, type PdfRow } from "@/lib/pdf";
import { formatDate, humanize, num } from "@/lib/utils";

/** Client-safe BOQ: quantities and selling rates only – internal costs and margins never appear. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (!c || !c.can("boq:view") || c.role === "CLIENT" || c.role === "VENDOR") return new Response("Forbidden", { status: 403 });
  const b = await db.boq.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } }, project: { include: { client: true } } } });
  if (!b) return new Response("Not found", { status: 404 });

  const company = await loadCompany(c.companyId);
  const rows: PdfRow[] = [];
  let n = 0;
  let grand = 0;
  for (const cat of BOQ_CATEGORIES) {
    const items = b.items.filter((i) => i.category === cat);
    if (!items.length) continue;
    rows.push({ kind: "group", cells: [humanize(cat)] });
    let sub = 0;
    for (const i of items) {
      sub += num(i.total);
      rows.push({ cells: [String(++n), i.specification ? `${i.item}\n${i.specification}` : i.item, i.unit, String(num(i.quantity)), inr(i.sellingRate), inr(i.total)] });
    }
    grand += sub;
    rows.push({ kind: "subtotal", cells: ["", `Subtotal – ${humanize(cat)}`, "", "", "", inr(sub)] });
  }
  const buf = await renderPdf(company, {
    title: "BILL OF QUANTITIES",
    number: b.number,
    meta: [["Status", humanize(b.status)], ["Revision", String(b.revision)], ["Date", formatDate(b.updatedAt)]],
    party: b.project ? { heading: "Project", lines: [b.project.name, b.project.client.name, b.project.siteAddress ?? ""].filter(Boolean) } : { heading: "Title", lines: [b.title] },
    columns: [{ header: "#", width: 24 }, { header: "Item", width: 250 }, { header: "Unit", width: 40 }, { header: "Qty", width: 50, align: "right" }, { header: "Rate", width: 80, align: "right" }, { header: "Amount", width: 90, align: "right" }],
    rows,
    totals: [["Total (excl. GST)", inr(grand)]],
    note: "Amounts are exclusive of GST.",
    signatory: company.name,
  });
  return pdfResponse(buf, `${b.number}.pdf`);
}
