import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { kpiReport, MIN_SAMPLE, WINDOW_DAYS, type Kpi } from "@/lib/kpis";
import { cn, formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Key numbers" };

const TONE: Record<Kpi["tone"], string> = { good: "text-emerald-700", warn: "text-amber-600", bad: "text-red-600", none: "text-slate-400" };

export default async function KpiPage() {
  const c = await requirePerm("exceptions:view");
  const r = await kpiReport(c);
  return (
    <>
      <PageHeader title="Key numbers" subtitle={`Worked out from real records, last ${WINDOW_DAYS} days. Each number says what it is based on; with fewer than ${MIN_SAMPLE} records it shows a dash instead of a misleading percentage.`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {r.kpis.map((k) => (
          <Card key={k.key}>
            <CardHeader><CardTitle>{k.label}</CardTitle></CardHeader>
            <CardBody className="space-y-2">
              <p className={cn("tabular text-3xl font-bold", TONE[k.tone])}>{k.value}</p>
              <p className="text-xs text-slate-600">{k.basis}</p>
              {k.target && <p className="text-xs text-slate-500">{k.target} <span className="text-slate-400">(a suggestion: DSC to approve)</span></p>}
              <details className="text-xs text-slate-500"><summary className="cursor-pointer text-slate-600">How it is counted</summary><p className="mt-1">{k.definition}</p></details>
              {k.link && <Link href={k.link} className="text-xs font-medium text-brand-700 hover:underline">See the records →</Link>}
            </CardBody>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>Not shown yet, and why</CardTitle></CardHeader>
        <CardBody className="space-y-1 text-sm text-slate-600">
          {r.notYet.map((n) => <p key={n.label}><b>{n.label}</b>: {n.why}</p>)}
          <p className="pt-2 text-xs text-slate-500">Checked {formatDateTime(r.generatedAt)}. You only see projects you are allowed to see; money figures appear only for people allowed to see finance.</p>
        </CardBody>
      </Card>
    </>
  );
}
