import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { projectMetrics, scoreProject } from "@/lib/scorecard";
import { loadCompany, pdfResponse, renderPdf, type PdfRow } from "@/lib/pdf";
import { formatDate } from "@/lib/utils";

/** The "Performance" evaluation form (as DSC fills in by hand today), completed from the system. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const c = await getCtx();
  if (!c || !c.can("scorecards:view")) return new Response("Forbidden", { status: 403 });
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) }, include: { client: { select: { name: true, companyName: true } } } });
  if (!p) return new Response("Not found", { status: 404 });
  const m = await projectMetrics(c.companyId, projectId);
  const r = m.review;
  const score = scoreProject(m, r);
  const [pm, sup, by] = await Promise.all([
    p.projectManagerId ? db.user.findUnique({ where: { id: p.projectManagerId }, select: { name: true } }) : null,
    p.supervisorId ? db.user.findUnique({ where: { id: p.supervisorId }, select: { name: true } }) : null,
    r ? db.user.findUnique({ where: { id: r.evaluatedById }, select: { name: true } }) : null,
  ]);
  const yn = (v: boolean | null | undefined) => (v === null || v === undefined ? "–" : v ? "Yes" : "No");
  const row = (a: string, b: string, d = ""): PdfRow => ({ cells: [a, b, d] });
  const sentAll = m.reportsExpected > 0 && m.reportsSent >= m.reportsExpected;
  const rows: PdfRow[] = [
    { kind: "group", cells: ["Project completion"] },
    row("Project completed on time", yn(m.onTime), m.onTime === false ? `${m.delayDays} day(s) late` : ""),
    row("Delay was under employee's control", yn(r?.delayInControl), r?.delayReason ?? ""),
    { kind: "group", cells: ["Quality"] },
    row("Work completed as per quality standards", yn(r ? !r.reworkRequired : null)),
    row("Rework required", yn(r?.reworkRequired)),
    row("Snag closed on time", yn(r?.snagClosedOnTime)),
    { kind: "group", cells: ["Labour management"] },
    row("Labour managed properly / discipline maintained", yn(r?.labourDiscipline)),
    row("Reports from site (labour attendance and manpower)", `${m.reportsSent}/${m.reportsExpected}`, `${m.reportsOnTime} on time`),
    { kind: "group", cells: ["Material management"] },
    row("Material arranged on time", m.posWithDate ? yn(m.posLate === 0) : "–", m.posWithDate ? `${m.posWithDate - m.posLate} of ${m.posWithDate} deliveries on time` : ""),
    row("Material wastage controlled", yn(r?.wastageControlled)),
    { kind: "group", cells: ["Client satisfaction"] },
    row("Client satisfied with work", r?.clientRating ? (r.clientRating >= 5 ? "Excellent" : r.clientRating >= 4 ? "Good" : "Average or below") : "–", r?.clientRating ? `${r.clientRating} out of 5` : ""),
    { kind: "group", cells: ["Documentation"] },
    row("All documents submitted on time", m.closurePct === null ? "–" : yn(m.closurePct >= 1), m.closurePct === null ? "Closure checklist not started" : `${Math.round(m.closurePct * 100)}% of the closure checklist`),
    row("Site photos updated regularly", m.reportsExpected ? yn(sentAll) : "–"),
    { kind: "group", cells: ["Safety"] },
    row("Safety rules followed", yn(r?.safetyFollowed)),
    { kind: "group", cells: [`Overall score: ${score.total} / 100 – ${score.label}${score.provisional ? " (provisional)" : ""}`] },
    ...score.parts.map((x) => row(x.label, `${x.points} / ${x.max}`, x.detail)),
    { kind: "group", cells: ["Remarks"] },
    row(r?.remarks?.trim() || "—", "", ""),
  ];

  const company = await loadCompany(c.companyId);
  const buf = await renderPdf(company, {
    title: "PERFORMANCE EVALUATION",
    number: p.code,
    meta: [["Project", p.name], ["Project manager", pm?.name ?? "—"], ["Site supervisor", sup?.name ?? "—"], ["Evaluation date", formatDate(r?.updatedAt ?? new Date())], ["Evaluated by", by?.name ?? "Not yet recorded"]],
    party: { heading: "Client", lines: [p.client.companyName ?? p.client.name, p.siteAddress ?? ""].filter(Boolean) },
    columns: [{ header: "Evaluation point", width: 250 }, { header: "Result", width: 80, align: "center" }, { header: "Remarks", width: 200 }],
    rows,
    signatory: company.name,
  });
  return pdfResponse(buf, `performance-${p.code}.pdf`);
}
