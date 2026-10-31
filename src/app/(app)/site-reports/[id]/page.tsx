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
  const [by, files, labour] = await Promise.all([
    db.user.findUnique({ where: { id: r.submittedById }, select: { name: true } }),
    db.document.findMany({ where: { id: { in: r.photoIds }, companyId: c.companyId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    db.siteLabour.findMany({ where: { companyId: c.companyId, projectId: r.project.id, date: r.reportDate }, orderBy: { createdAt: "asc" } }),
  ]);
  const photos = files.filter((f) => f.mimeType.startsWith("image/"));
  const voices = files.filter((f) => f.mimeType.startsWith("audio/"));
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
                  <a href={`/documents/${p.id}/download`} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/documents/${p.id}/download?inline=1`} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                    {/selfie/i.test(p.name) && <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">Selfie</span>}
                  </a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {voices.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Voice note{voices.length > 1 ? "s" : ""}</CardTitle></CardHeader>
          <CardBody className="space-y-2">{voices.map((v) => <audio key={v.id} controls preload="none" src={`/documents/${v.id}/download?inline=1`} className="w-full" />)}</CardBody>
        </Card>
      )}

      {labour.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Site attendance ({labour.length})</CardTitle></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm rt">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Name</th><th className="px-3 py-2">Work</th><th className="px-3 py-2">Came</th><th className="px-3 py-2">Left</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {labour.map((l) => <tr key={l.id}><td className="px-4 py-2 font-medium text-slate-900">{l.name}</td><td className="px-3 py-2 text-slate-600">{l.work ?? "—"}</td><td className="tabular px-3 py-2">{l.inTime ?? "—"}</td><td className="tabular px-3 py-2">{l.outTime ?? "—"}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
