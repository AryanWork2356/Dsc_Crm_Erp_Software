import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { amountInWords } from "@/lib/money";
import { inr, loadCompany, pdfResponse, renderPdf } from "@/lib/pdf";
import { formatDate, num } from "@/lib/utils";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (!c || !c.can("purchase_orders:view")) return new Response("Forbidden", { status: 403 });
  const po = await db.purchaseOrder.findFirst({ where: { id, companyId: c.companyId }, include: { vendor: true, project: true, items: true } });
  if (!po) return new Response("Not found", { status: 404 });
  if (c.role === "CLIENT") return new Response("Forbidden", { status: 403 });
  if (c.role === "VENDOR" && (po.vendorId !== c.vendorId || ["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(po.status))) return new Response("Not found", { status: 404 });
  const company = await loadCompany(c.companyId);

  const buf = await renderPdf(company, {
    title: "PURCHASE ORDER",
    number: po.number,
    meta: [["Date", formatDate(po.orderDate)], ["Delivery by", formatDate(po.deliveryDate)], ...(po.paymentTerms ? [["Payment", po.paymentTerms] as [string, string]] : [])],
    party: { heading: "Vendor", lines: [po.vendor.name, po.vendor.contactPerson ? `Attn: ${po.vendor.contactPerson}` : "", po.vendor.address ?? "", po.vendor.gstin ? `GSTIN: ${po.vendor.gstin}` : "", po.vendor.phone ?? ""].filter(Boolean) },
    party2: { heading: "Deliver to", lines: [po.project ? po.project.name : company.name, po.project?.siteAddress ?? company.address ?? ""].filter(Boolean) },
    columns: [{ header: "#", width: 22 }, { header: "Item", width: 220 }, { header: "Unit", width: 38 }, { header: "Qty", width: 46, align: "right" }, { header: "Rate", width: 76, align: "right" }, { header: "GST", width: 34, align: "right" }, { header: "Amount", width: 86, align: "right" }],
    rows: po.items.map((i, n) => ({ cells: [String(n + 1), i.description, i.unit, String(num(i.quantity)), inr(i.rate), `${num(i.taxPercent)}%`, inr(i.amount)] })),
    totals: [["Subtotal", inr(po.subtotal)], ...(num(po.discountAmount) > 0 ? [["Discount", `- ${inr(po.discountAmount)}`] as [string, string]] : []), ["GST", inr(po.taxAmount)], ["Total", inr(po.total)]],
    amountWords: amountInWords(num(po.total)),
    sections: po.notes ? [{ heading: "Terms & conditions", body: po.notes }] : [],
    signatory: company.name,
  });
  return pdfResponse(buf, `${po.number}.pdf`);
}
