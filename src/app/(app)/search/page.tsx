import Link from "next/link";
import { Search } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { globalSearch } from "@/lib/search";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const c = await requireCtx();
  const { q = "" } = await searchParams;
  const groups = await globalSearch(c, q);
  const total = groups.reduce((s, g) => s + g.hits.length, 0);
  return (
    <>
      <PageHeader title="Search" subtitle={q.trim().length >= 2 ? `${total} result(s) for “${q.trim()}”` : "Search clients, leads, projects, vendors, quotations, orders, invoices and more."} />
      <form className="relative mb-5 max-w-xl" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input name="q" defaultValue={q} autoFocus placeholder="Type at least 2 letters…" className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200" aria-label="Search" />
      </form>
      {q.trim().length >= 2 && groups.length === 0 && <Card><EmptyState title="Nothing found" hint="Try a different spelling, a phone number, or an ID like PRJ-00001." /></Card>}
      <div className="grid gap-5 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.key}>
            <CardHeader><CardTitle>{g.label} <span className="font-normal text-slate-400">({g.hits.length})</span></CardTitle></CardHeader>
            <ul className="divide-y divide-slate-100">{g.hits.map((h) => <li key={h.id}><Link href={h.href} className="block px-5 py-3 hover:bg-slate-50"><p className="text-sm font-medium text-slate-900">{h.title}</p>{h.sub && <p className="text-xs text-slate-500">{h.sub}</p>}</Link></li>)}</ul>
          </Card>
        ))}
      </div>
    </>
  );
}
