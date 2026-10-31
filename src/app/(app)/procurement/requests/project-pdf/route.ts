import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { PR_ALL } from "@/lib/doc-access";
import { inr, loadCompany, pdfResponse, renderPdf, type PdfDocSpec, type PdfRow } from "@/lib/pdf";
import { projectHistory } from "@/lib/material-history";
import { formatDate, humanize, num } from "@/lib/utils";

/**
 * A project's full material and money history for the office: every request (asked, ordered, arrived, still to send), every
 * purchase order, vendor bill and payment, expenses, client invoices and payments, and at the end each material's totals.
 * Office roles only (directors, admin, procurement, accounts); each money table is shown only to those allowed to see it.
 */
export async function GET(req: NextRequest) {
  const c = await getCtx();
  if (!c || !c.can("purchase_requests:view") || !PR_ALL.includes(c.role)) return new Response("Forbidden", { status: 403 });
  const projectId = req.nextUrl.searchParams.get("project") ?? "";
  const project = await db.project.findFirst({ where: { id: projectId, companyId: c.companyId, deletedAt: null }, include: { client: { select: { name: true } } } });
  if (!project) return new Response("Not found", { status: 404 });

  const [company, h] = await Promise.all([loadCompany(c.companyId), projectHistory(c.companyId, project.id)]);
  const see = { orders: c.can("purchase_orders:view"), bills: c.can("vendor_bills:view"), expenses: c.can("expenses:view"), invoices: c.can("invoices:view") };
  const q = (n: number) => (n ? String(n) : "–");

  const rows: PdfRow[] = h.requests.flatMap((r) => [
    { kind: "group" as const, cells: [`${r.number}  ·  ${formatDate(r.date)}  ·  ${humanize(r.status)}  ·  by ${r.by || "—"}${r.neededBy ? `  ·  needed by ${formatDate(r.neededBy)}` : ""}`] },
    ...r.lines.map((l) => ({ cells: [l.description, l.unit, String(l.requested), q(l.ordered), q(l.received), q(l.pending)] })),
  ]);

  const tables: NonNullable<PdfDocSpec["tables"]> = [];
  if (see.orders) tables.push({
    heading: "Purchase orders",
    columns: [{ header: "Order", width: 70 }, { header: "Date", width: 62 }, { header: "Vendor", width: 150 }, { header: "Status", width: 80 }, { header: "Items", width: 36, align: "right" }, { header: "Total", width: 90, align: "right" }],
    rows: h.orders.map((o) => ({ cells: [o.number, formatDate(o.orderDate), o.vendor.name, humanize(o.status), String(o.items.length), inr(o.total)] })),
    note: "Only approved orders count as ordered in the totals.",
  });
  if (see.bills) {
    tables.push({
      heading: "Vendor bills",
      columns: [{ header: "Bill", width: 70 }, { header: "Date", width: 62 }, { header: "Vendor", width: 140 }, { header: "Order", width: 62 }, { header: "Amount", width: 80, align: "right" }, { header: "Paid", width: 80, align: "right" }, { header: "Balance", width: 80, align: "right" }],
      rows: h.bills.map((b) => ({ cells: [b.number, formatDate(b.billDate), b.vendor.name, b.po?.number ?? "–", inr(b.amount), inr(b.paid), inr(num(b.amount) - num(b.paid))] })),
    });
    tables.push({
      heading: "Payments to vendors",
      columns: [{ header: "Date", width: 62 }, { header: "Vendor", width: 150 }, { header: "Bill", width: 70 }, { header: "Method", width: 90 }, { header: "Reference", width: 90 }, { header: "Amount", width: 80, align: "right" }],
      rows: h.vendorPayments.map((p) => ({ cells: [formatDate(p.date), p.vendor, p.bill, humanize(p.method), p.reference ?? "–", inr(p.amount)] })),
    });
  }
  if (see.expenses) tables.push({
    heading: "Expenses on this project",
    columns: [{ header: "Date", width: 62 }, { header: "Type", width: 70 }, { header: "What", width: 200 }, { header: "Paid by", width: 80 }, { header: "Amount", width: 80, align: "right" }],
    rows: h.expenses.map((e) => ({ cells: [formatDate(e.date), humanize(e.category), `${e.description}${e.approved ? "" : " (not approved)"}`, e.paidBy ?? "–", inr(e.amount)] })),
  });
  if (see.invoices) {
    tables.push({
      heading: "Invoices to the client",
      columns: [{ header: "Invoice", width: 80 }, { header: "Date", width: 62 }, { header: "Status", width: 80 }, { header: "Total", width: 90, align: "right" }, { header: "Received", width: 90, align: "right" }, { header: "Balance", width: 90, align: "right" }],
      rows: h.invoices.map((i) => ({ cells: [i.number, formatDate(i.issueDate), humanize(i.status), inr(i.total), inr(i.paid), inr(num(i.total) - num(i.paid))] })),
    });
    tables.push({
      heading: "Payments received from the client",
      columns: [{ header: "Date", width: 62 }, { header: "Invoice", width: 80 }, { header: "Method", width: 90 }, { header: "Reference", width: 110 }, { header: "Amount", width: 90, align: "right" }],
      rows: h.clientPayments.map((p) => ({ cells: [formatDate(p.date), p.invoice, humanize(p.method), p.reference ?? "–", inr(p.amount)] })),
    });
  }
  const m = h.money;
  const moneyRows: [string, string, boolean][] = [
    ["Contract value", inr(project.contractValue), see.invoices],
    ["Material ordered (approved orders)", inr(m.ordered), see.orders],
    ["Vendor bills", inr(m.billed), see.bills],
    ["Paid to vendors", inr(m.paidVendors), see.bills],
    ["Still to pay vendors", inr(m.billed - m.paidVendors), see.bills],
    ["Expenses (approved)", inr(m.expenses), see.expenses],
    ["Invoiced to the client", inr(m.invoiced), see.invoices],
    ["Received from the client", inr(m.received), see.invoices],
    ["Still to receive from the client", inr(m.invoiced - m.received), see.invoices],
  ];
  const shown = moneyRows.filter(([, , ok]) => ok);
  if (shown.length) tables.push({ heading: "Money summary", columns: [{ header: "", width: 300 }, { header: "Amount", width: 120, align: "right" }], rows: shown.map(([k, v]) => ({ cells: [k, v] })) });

  tables.push({
    heading: "Each material – totals for the project",
    columns: [{ header: "Material", width: 190 }, { header: "Unit", width: 40 }, { header: "Requested", width: 58, align: "right" }, { header: "Ordered", width: 54, align: "right" }, { header: "Received", width: 54, align: "right" }, { header: "Pending to send", width: 62, align: "right" }, ...(see.orders ? [{ header: "Order value", width: 80, align: "right" as const }] : [])],
    rows: h.materials.map((x) => ({ cells: [x.description, x.unit, q(x.requested), q(x.ordered), q(x.received), q(x.pending), ...(see.orders ? [x.value ? inr(x.value) : "–"] : [])] })),
    note: "Requested = requests sent by the site (drafts and rejected requests are not counted). Ordered and received = all approved purchase orders for this project. Pending to send = requested minus ordered.",
  });

  const buf = await renderPdf(company, {
    title: "PROJECT HISTORY",
    number: project.code,
    meta: [["Printed", formatDate(new Date())], ["Status", humanize(project.status)], ["Requests", String(h.requests.length)]],
    party: { heading: "Project", lines: [project.name, project.siteAddress ?? ""].filter(Boolean) },
    party2: { heading: "Client", lines: [project.client.name] },
    columns: [{ header: "Material", width: 210 }, { header: "Unit", width: 44 }, { header: "Requested", width: 60, align: "right" }, { header: "Ordered", width: 56, align: "right" }, { header: "Received", width: 56, align: "right" }, { header: "Pending to send", width: 66, align: "right" }],
    rows: rows.length ? rows : [{ cells: ["No material requests yet.", "", "", "", "", ""] }],
    tables,
  });
  return pdfResponse(buf, `${project.code} history.pdf`);
}
