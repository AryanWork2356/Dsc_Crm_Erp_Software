import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { REPORTS, canRun } from "@/lib/reports";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const c = await requirePerm("reports:view");
  const mine = REPORTS.filter((r) => canRun(c, r));
  const groups = [...new Set(mine.map((r) => r.group))];
  return (
    <>
      <PageHeader title="Reports" subtitle="Pick a report, set the dates, and export to Excel, CSV or PDF." />
      {mine.length === 0 ? <Card><EmptyState title="No reports available for your role" /></Card> : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{g}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mine.filter((r) => r.group === g).map((r) => (
                  <Link key={r.key} href={`/reports/${r.key}`} className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow-md">
                    <span className="rounded-lg bg-brand-50 p-2 text-brand-700"><FileBarChart className="h-5 w-5" /></span>
                    <span><span className="block font-medium text-slate-900 group-hover:text-brand-700">{r.title}</span><span className="mt-0.5 block text-sm text-slate-500">{r.description}</span></span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          {c.can("finance:view") && <section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Management</h2><Link href="/dashboard" className="inline-block rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium text-brand-700 shadow-sm hover:shadow-md">Management dashboard →</Link></section>}
        </div>
      )}
    </>
  );
}
