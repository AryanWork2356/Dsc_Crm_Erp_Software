import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { amountInWords } from "@/lib/money";
import { bankSection, inr, loadCompany, pdfResponse, renderPdf } from "@/lib/pdf";
import { formatDate, num } from "@/lib/utils";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (!c || !c.can("invoices:view")) return new Response("Forbidden", { status: 403 });
  const inv = await db.invoice.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { client: true, project: true, items: true } });
  if (!inv) return new Response("Not found", { status: 404 });
  if (c.role === "VENDOR") return new Response("Forbidden", { status: 403 });
  if (c.role === "CLIENT" && (inv.clientId !== c.clientId || ["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(inv.status))) return new Response("Not found", { status: 404 });
  const company = await loadCompany(c.companyId);
  const balance = Math.max(0, num(inv.total) - num(inv.paid));
  const bank = bankSection(company);

  const buf = await renderPdf(company, {
    title: "TAX INVOICE",
    number: inv.number,
    meta: [["Date", formatDate(inv.issueDate)], ...(inv.dueDate ? [["Due", formatDate(inv.dueDate)] as [string, string]] : []), ["Status", inv.status === "DRAFT" || inv.status === "PENDING_APPROVAL" ? "DRAFT" : inv.status.replace("_", " ")]],
    party: { heading: "Bill to", lines: [inv.client.companyName ?? inv.client.name, inv.client.companyName ? `Attn: ${inv.client.name}` : "", inv.client.billingAddress ?? inv.client.address ?? "", inv.client.gstin ? `GSTIN: ${inv.client.gstin}` : ""].filter(Boolean) },
    party2: inv.project ? { heading: "Project", lines: [inv.project.name, inv.project.siteAddress ?? ""].filter(Boolean) } : undefined,
    columns: [{ header: "#", width: 22 }, { header: "Description", width: 240 }, { header: "Unit", width: 40 }, { header: "Qty", width: 44, align: "right" }, { header: "Rate", width: 76, align: "right" }, { header: "GST", width: 32, align: "right" }, { header: "Amount", width: 86, align: "right" }],
    rows: inv.items.map((i, n) => ({ cells: [String(n + 1), i.description, i.unit, String(num(i.quantity)), inr(i.rate), `${num(i.taxPercent)}%`, inr(i.amount)] })),
    totals: [["Subtotal", inr(inv.subtotal)], ...(num(inv.discount) > 0 ? [["Discount", `- ${inr(inv.discount)}`] as [string, string]] : []), ["GST", inr(inv.taxAmount)], ...(num(inv.paid) > 0 ? [["Received", `- ${inr(inv.paid)}`] as [string, string]] : []), [num(inv.paid) > 0 ? "Balance due" : "Total", inr(num(inv.paid) > 0 ? balance : inv.total)]],
    amountWords: amountInWords(num(inv.paid) > 0 ? balance : num(inv.total)),
    sections: [inv.paymentTerms ? { heading: "Payment terms", body: inv.paymentTerms } : null, inv.notes ? { heading: "Notes", body: inv.notes } : null, bank].filter(Boolean) as { heading: string; body: string }[],
    signatory: company.name,
  });
  return pdfResponse(buf, `${inv.number}.pdf`);
}
