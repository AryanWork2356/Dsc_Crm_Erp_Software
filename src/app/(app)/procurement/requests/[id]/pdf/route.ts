import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { PR_ALL } from "@/lib/doc-access";
import { loadCompany, pdfResponse, renderPdf } from "@/lib/pdf";
import { requestLines } from "@/lib/material-history";
import { formatDate, humanize } from "@/lib/utils";

/** One purchase request: what was asked for, what is ordered, what arrived, and what is still to be sent. No prices. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (!c || !c.can("purchase_requests:view")) return new Response("Forbidden", { status: 403 });
  const pr = await db.purchaseRequest.findFirst({ where: { id, companyId: c.companyId }, include: { project: { select: { id: true, code: true, name: true, siteAddress: true } } } });
  if (!pr) return new Response("Not found", { status: 404 });
  if (!PR_ALL.includes(c.role) && pr.requestedById !== c.userId) {
    const mine = pr.projectId ? await db.project.findFirst({ where: { id: pr.projectId, ...projectScope(c) }, select: { id: true } }) : null;
    if (!mine) return new Response("Forbidden", { status: 403 });
  }
  const [company, lines, by, pos] = await Promise.all([
    loadCompany(c.companyId),
    requestLines(id),
    db.user.findUnique({ where: { id: pr.requestedById }, select: { name: true } }),
    db.purchaseOrder.findMany({ where: { requestId: id }, select: { number: true, status: true, orderDate: true, deliveryDate: true }, orderBy: { orderDate: "asc" } }),
  ]);
  const q = (n: number) => (n ? String(n) : "–");
  const pending = lines.filter((l) => l.pending > 0).length;

  const buf = await renderPdf(company, {
    title: "MATERIAL REQUEST",
    number: pr.number,
    meta: [["Date", formatDate(pr.createdAt)], ["Needed by", formatDate(pr.requiredDate)], ["Status", humanize(pr.status)], ["Priority", humanize(pr.priority)]],
    party: { heading: "Project", lines: pr.project ? [`${pr.project.code} · ${pr.project.name}`, pr.project.siteAddress ?? ""].filter(Boolean) : ["General stock"] },
    party2: { heading: "Requested by", lines: [by?.name ?? "—"] },
    columns: [{ header: "#", width: 22 }, { header: "Material", width: 200 }, { header: "Unit", width: 44 }, { header: "Requested", width: 60, align: "right" }, { header: "Ordered", width: 56, align: "right" }, { header: "Received", width: 56, align: "right" }, { header: "Pending to send", width: 66, align: "right" }],
    rows: lines.map((l, n) => ({ cells: [String(n + 1), l.description, l.unit, String(l.requested), q(l.ordered), q(l.received), q(l.pending)] })),
    note: pending ? `${pending} item(s) still to be sent. "Pending to send" = requested minus ordered.` : "Everything on this request has been ordered.",
    tables: pos.length ? [{ heading: "Purchase orders for this request", columns: [{ header: "Order", width: 100 }, { header: "Date", width: 90 }, { header: "Delivery by", width: 90 }, { header: "Status", width: 120 }], rows: pos.map((p) => ({ cells: [p.number, formatDate(p.orderDate), formatDate(p.deliveryDate), humanize(p.status)] })) }] : [],
    sections: pr.reason ? [{ heading: "Reason", body: pr.reason }] : [],
  });
  return pdfResponse(buf, `${pr.number}.pdf`);
}
