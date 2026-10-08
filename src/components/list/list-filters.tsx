"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/form";

export type FilterDef = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

/** URL-driven search + filters. Server components read the same params, so state survives reloads/links. */
export function ListFilters({
  placeholder = "Search…",
  filters = [],
  exportHref,
}: {
  placeholder?: string;
  filters?: FilterDef[];
  exportHref?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get("q") ?? "");

  const push = React.useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      next.delete("page");
      router.replace(`${pathname}?${next}`);
    },
    [params, pathname, router],
  );

  React.useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) push({ q });
    }, 350);
    return () => clearTimeout(t);
  }, [q, params, push]);

  const active = params.get("q") || filters.some((f) => params.get(f.key));
  const exportUrl = exportHref ? `${exportHref}${exportHref.includes("?") ? "&" : "?"}${params.toString()}` : null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" aria-label="Search" />
      </div>
      {filters.map((f) => (
        <Select
          key={f.key}
          value={params.get(f.key) ?? ""}
          onChange={(e) => push({ [f.key]: e.target.value })}
          className="w-auto min-w-[140px]"
          aria-label={f.label}
        >
          <option value="">{f.label}: All</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ))}
      {active && (
        <button
          onClick={() => {
            setQ("");
            router.replace(pathname);
          }}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <X className="h-4 w-4" /> Clear
        </button>
      )}
      {exportUrl && (
        <a href={exportUrl} className="ml-auto text-sm font-medium text-brand-700 hover:underline">
          Export CSV
        </a>
      )}
    </div>
  );
}
