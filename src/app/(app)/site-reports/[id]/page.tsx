import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { formatDate, formatDateTime } from "@/lib/utils";
import { MATERIAL_STATUS_LABEL } from "@/lib/site-reports";
import { PageHeader, DetailGrid } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Site report" };

export default async function SiteReportPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePerm("site_reports:view");
  const { id } = await params;
  const r = await db.dailyReport.findFirst({ where: { id, companyId: c.companyId, project: projectScope(c) }, include: { project: { select: { id: true, code: true, name: true } } } });
  if (!r) notFound();
  const [by, photos] = await Promise.all([
    db.user.findUnique({ where: { id: r.submittedById }, select: { name: true } }),
    db.document.findMany({ where: { id: { in: r.photoIds }, companyId: c.companyId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
  ]);
  const morning = r.kind === "MORNING";

  return (
    <div>
      <PageHeader
        back={{ href: "/site-reports", label: "Daily site reports" }}
        title={`${r.project.name} – ${morning ? "Morning update" : "Evening report"}`}
        subtitle={`${r.project.code} · ${formatDate(r.reportDate)}`}
        actions={<>{r.onTime ? <Badge tone="green">On time</Badge> : <Badge tone="amber">Sent late</Badge>}{r.materialStatus !== "OK" && <Badge tone={r.materialStatus === "WORK_STOPPED" ? "red" : "amber"}>{MATERIAL_STATUS_LABEL[r.materialStatus]}</Badge>}</>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{morning ? "Today's plan" : "Work done"}</CardTitle></CardHeader>
          <CardBody className="space-y-5 text-sm text-slate-700">
            <p className="whitespace-pre-wrap text-base text-slate-900">{(morning ? r.planNext : r.workDone) || "—"}</p>
            {!morning && r.planNext && <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Plan for tomorrow</p><p className="whitespace-pre-wrap">{r.planNext}</p></div>}
            {r.issues && <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">Problem reported</p><p className="whitespace-pre-wrap text-amber-900">{r.issues}</p></div>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardBody>
            <DetailGrid items={[
              { label: "Sent by", value: by?.name ?? "—" },
              { label: "Sent at", value: formatDateTime(r.submittedAt) },
              { label: "People on site", value: r.manpower },
              ...(r.progressPct !== null ? [{ label: "Site finished", value: `${r.progressPct}%` }] : []),
              { label: "Material", value: MATERIAL_STATUS_LABEL[r.materialStatus] },
            ]} />
          </CardBody>
        </Card>
      </div>

      {photos.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Photos ({photos.length})</CardTitle></CardHeader>
          <CardBody>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((p) => (
                <li key={p.id}>
                  <a href={`/documents/${p.id}/download`} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/documents/${p.id}/download`} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                  </a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
