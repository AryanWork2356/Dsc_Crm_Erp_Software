import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">{children}</thead>;
}

export function Th({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <th className={cn("whitespace-nowrap px-4 py-3 font-medium", right && "text-right", className)}>{children}</th>;
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn("border-b border-slate-100 last:border-0 hover:bg-slate-50/60", className)}>{children}</tr>;
}

export function Td({ children, className, right }: { children?: React.ReactNode; className?: string; right?: boolean }) {
  return <td className={cn("px-4 py-3 align-middle text-slate-700", right && "tabular text-right", className)}>{children}</td>;
}

/** Sortable header that links to ?sort=&dir= preserving other params. */
export function SortTh({
  label,
  field,
  sp,
  basePath,
  right,
}: {
  label: string;
  field: string;
  sp: Record<string, string | undefined>;
  basePath: string;
  right?: boolean;
}) {
  const active = sp.sort === field;
  const dir = active && sp.dir === "asc" ? "desc" : "asc";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "sort" && k !== "dir" && k !== "page") q.set(k, v);
  q.set("sort", field);
  q.set("dir", dir);
  return (
    <Th right={right}>
      <Link href={`${basePath}?${q}`} className="inline-flex items-center gap-1 hover:text-slate-900">
        {label}
        {active && (sp.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </Link>
    </Th>
  );
}

export function Pagination({
  total,
  page,
  pageSize,
  sp,
  basePath,
}: {
  total: number;
  page: number;
  pageSize: number;
  sp: Record<string, string | undefined>;
  basePath: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className="rounded-md border border-slate-300 p-1.5 hover:bg-slate-50" aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Link>
        ) : (
          <span className="rounded-md border border-slate-200 p-1.5 text-slate-300"><ChevronLeft className="h-4 w-4" /></span>
        )}
        <span className="px-2 tabular">
          Page {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className="rounded-md border border-slate-300 p-1.5 hover:bg-slate-50" aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className="rounded-md border border-slate-200 p-1.5 text-slate-300"><ChevronRight className="h-4 w-4" /></span>
        )}
      </div>
    </div>
  );
}
