import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { projectFinancials } from "@/lib/project-finance";
import { loadClosure } from "@/lib/closure";
import { inr, loadCompany, pdfResponse, renderPdf, type PdfRow } from "@/lib/pdf";
import { formatDate, num } from "@/lib/utils";

/** Project closure report for the Commercial Director and Managing Director (HR SOP / Commercial Director SOP). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const c = await getCtx();
  if (!c || !c.can("closure:view") || !c.can("margins:view")) return new Response("Forbidden", { status: 403 });
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) }, include: { client: { select: { name: true, companyName: true } } } });
  if (!p) return new Response("Not found", { status: 404 });
  const [v, fin, bills] = await Promise.all([
    loadClosure(c.companyId, projectId),
    projectFinancials(c.companyId, [projectId]).then((m) => m.get(projectId)),
    db.vendorBill.findMany({ where: { companyId: c.companyId, projectId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, include: { vendor: { select: { name: true } } } }),
  ]);
  if (!v || !fin) return new Response("No closure checklist for this project yet", { status: 404 });

  const vendorOwed = bills.reduce((s, b) => s + num(b.amount) - num(b.paid), 0);
  const row = (a: string, b: string, kind?: PdfRow["kind"]): PdfRow => ({ cells: [a, b], kind });
  const rows: PdfRow[] = [
    { kind: "group", cells: ["1. Project profitability"] },
    row("Contract value (excl. GST)", inr(fin.contractValue)),
    row("Budget (from BOQ)", inr(fin.budget)),
    row("Actual cost – material", inr(fin.material)), row("Actual cost – labour", inr(fin.labour)), row("Actual cost – vendors and sub-contractors", inr(fin.vendor)), row("Actual cost – other", inr(fin.other)),
    row("Total actual cost", inr(fin.actualCost), "subtotal"),
    row("Variance against budget", `${fin.variance > 0 ? "+" : ""}${inr(fin.variance)} (${fin.variancePct.toFixed(1)}%)`),
    row("Profit", `${inr(fin.profit)}  (${fin.marginPct.toFixed(1)}% margin)`, "subtotal"),
    { kind: "group", cells: ["2. Collection status"] },
    row("Billed (excl. GST)", inr(fin.billed)), row("Collected", inr(fin.collected)), row("Still to collect", inr(fin.outstanding), "subtotal"),
    { kind: "group", cells: ["3. Vendor outstanding and pending liabilities"] },
    row("Unpaid vendor bills", `${bills.length} bill(s) · ${inr(vendorOwed)}`),
    ...bills.slice(0, 12).map((b) => row(`   ${b.vendor.name} – bill ${b.number}`, `${inr(num(b.amount) - num(b.paid))}${b.certifiedAt ? "" : "  (not certified)"}`)),
    { kind: "group", cells: [`4. Commercial closure checklist – ${v.done} of ${v.total} complete`] },
    ...v.items.map((i) => row(`${i.effectiveDone ? "[x]" : "[ ]"}  ${i.title}`, i.auto ? (i.detail ?? "") : i.effectiveDone ? `Done ${formatDate(i.doneAt)}` : "Pending")),
    { kind: "group", cells: ["5. Lessons learned"] },
    row(v.closure.lessonsLearned?.trim() || "Not written yet.", ""),
  ];

  const company = await loadCompany(c.companyId);
  const buf = await renderPdf(company, {
    title: "PROJECT CLOSURE REPORT",
    number: p.code,
    meta: [["Project", p.name], ["Handover / completion", formatDate(p.actualEndDate)], ["Checklist started", formatDate(v.closure.startedAt)], ["Status", v.closure.status === "CLOSED" ? "Closed" : v.closure.status === "SUBMITTED" ? "With directors" : "In progress"]],
    party: { heading: "Client", lines: [p.client.companyName ?? p.client.name, p.siteAddress ?? ""].filter(Boolean) },
    columns: [{ header: "Item", width: 330 }, { header: "Detail", width: 200, align: "right" }],
    rows,
    signatory: company.name,
  });
  return pdfResponse(buf, `closure-report-${p.code}.pdf`);
}
