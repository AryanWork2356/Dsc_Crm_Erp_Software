import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { monthlyReport, weeklyReport } from "@/lib/director-reports";
import { inr, loadCompany, pdfResponse, renderPdf, type PdfRow } from "@/lib/pdf";
import { formatDate } from "@/lib/utils";

/** Weekly / monthly report for the Managing Director, as a printable PDF. */
export async function GET(req: NextRequest) {
  const c = await getCtx();
  if (!c || !c.can("finance:view")) return new Response("Forbidden", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const row = (a: string, b = "", bold?: boolean): PdfRow => ({ cells: [a, b], kind: bold ? "subtotal" : undefined });
  const grp = (t: string): PdfRow => ({ kind: "group", cells: [t] });
  const rows: PdfRow[] = [];
  let title: string;
  let meta: [string, string][];

  if (sp.get("kind") === "monthly") {
    const m = /^(\d{4})-(\d{2})$/.exec(sp.get("month") ?? "");
    const now = new Date();
    const year = m ? Number(m[1]) : now.getUTCFullYear();
    const month = m ? Number(m[2]) : now.getUTCMonth() + 1;
    const r = await monthlyReport(c.companyId, year, month);
    title = "MONTHLY REPORT";
    meta = [["Month", r.label]];
    rows.push(grp("Turnover"), row("Billed (excl. GST)", inr(r.billed), true), row(`Invoices issued`, String(r.invoicesIssued)), row("Collected", inr(r.collected)));
    rows.push(grp("Profitability (live and completed projects)"), row("Overall margin", `${r.profitability.overallMarginPct.toFixed(1)}%  (${inr(r.profitability.profit)} on ${inr(r.profitability.contract)})`, true));
    r.profitability.best.forEach((x) => rows.push(row(`Best: ${x.code} ${x.name}`, `${x.marginPct.toFixed(1)}%  ${inr(x.profit)}`)));
    r.profitability.worst.forEach((x) => rows.push(row(`Lowest: ${x.code} ${x.name}`, `${x.marginPct.toFixed(1)}%  ${inr(x.profit)}`)));
    rows.push(grp("Vendor performance"));
    r.vendors.forEach((v) => rows.push(row(v.name, `${v.orders} order(s)  ${inr(v.value)}${v.late ? `  ${v.late} late` : ""}`)));
    rows.push(grp("New vendors developed"), row(r.newVendors.join(", ") || "None this month"));
    rows.push(grp("Projects closed"), row(r.projectsClosed.map((p) => `${p.code} ${p.name}`).join(", ") || "None this month"));
    rows.push(grp("Department performance – items past their time limit"));
    if (!r.overdueByDepartment.length) rows.push(row("Nothing is past its time limit"));
    r.overdueByDepartment.forEach((d) => rows.push(row(d.title, String(d.count))));
  } else {
    const r = await weeklyReport(c.companyId);
    title = "WEEKLY REPORT";
    meta = [["As on", formatDate(r.asOf)]];
    rows.push(grp("Receivables / collection"), row("Total to collect", inr(r.receivables.total), true), row("Overdue", `${inr(r.receivables.overdue)}  (${r.receivables.overdueCount} invoice(s))`), row("Falling due this week", inr(r.receivables.dueThisWeek)));
    r.receivables.byClient.forEach((x) => rows.push(row(`   ${x.name}`, `${inr(x.total)}${x.overdue ? `  (${inr(x.overdue)} overdue)` : ""}`)));
    rows.push(grp("Payables"), row("Total to pay", inr(r.payables.total), true), row("Overdue", `${inr(r.payables.overdue)}  (${r.payables.overdueCount} bill(s))`), row("Falling due this week", inr(r.payables.dueThisWeek)), row("Bills awaiting certification", `${r.payables.notCertified}  (${inr(r.payables.notCertifiedAmount)})`));
    r.payables.byVendor.forEach((x) => rows.push(row(`   ${x.name}`, `${inr(x.total)}${x.overdue ? `  (${inr(x.overdue)} overdue)` : ""}`)));
    rows.push(grp("Cash flow forecast – next 7 days"), row("Expected in", inr(r.forecast.in)), row("Expected out", inr(r.forecast.out)), row("Net", inr(r.forecast.net), true));
    rows.push(grp("Cash flow – last 6 months"));
    r.cashFlow.forEach((m) => rows.push(row(m.name, `in ${inr(m.income)}   out ${inr(m.expenses)}`)));
    rows.push(grp("Critical vendor payments (overdue over 30 days)"));
    if (!r.criticalVendors.length) rows.push(row("None"));
    r.criticalVendors.forEach((v) => rows.push(row(v.name, inr(v.overdue31plus))));
    rows.push(grp("High-risk outstanding (over 60 days late)"));
    if (!r.highRisk.length) rows.push(row("None"));
    r.highRisk.forEach((h) => rows.push(row(`${h.number}  ${h.client}`, `${inr(h.balance)}  ${h.daysLate} days late`)));
    rows.push(grp("Running late"));
    if (!r.overdueByDepartment.length) rows.push(row("Nothing is past its time limit"));
    r.overdueByDepartment.forEach((d) => rows.push(row(d.title, String(d.count))));
  }

  const company = await loadCompany(c.companyId);
  const buf = await renderPdf(company, { title, number: formatDate(new Date()), meta, columns: [{ header: "Item", width: 330 }, { header: "Amount / detail", width: 200, align: "right" }], rows, signatory: company.name });
  return pdfResponse(buf, `${title.toLowerCase().replace(/ /g, "-")}.pdf`);
}
