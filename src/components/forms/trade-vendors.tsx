"use client";
import * as React from "react";
import { Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export type TradeVendorData = {
  trades: { key: string; label: string }[];
  options: Record<string, { value: string; label: string }[]>;
  /** trade key → vendor id already chosen on the project */
  chosen?: Record<string, string>;
  /** trade keys already ticked (a project's work), even when no vendor is chosen yet */
};

/**
 * Step 1: tick the kinds of work this project has. Step 2: for each ticked kind, a dropdown with only the vendors who do that work.
 * An unticked kind sends nothing, so it is removed from the project. To add a vendor that is not in a list, add it under Procurement → Vendors.
 */
export function TradeVendors({ data }: { data: TradeVendorData }) {
  const [on, setOn] = React.useState<Set<string>>(() => new Set(Object.keys(data.chosen ?? {})));
  const toggle = (k: string) => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const ticked = data.trades.filter((t) => on.has(t.key));
  return (
    <div className="space-y-3 sm:col-span-2">
      <input type="hidden" name="trades_form" value="1" />
      <div>
        <p className="text-sm font-medium text-slate-800">What work is there on this project?</p>
        <p className="mt-0.5 text-xs text-slate-500">Tick the kinds of work. A vendor dropdown appears for each one you tick.</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {data.trades.map((t) => (
            <label key={t.key} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", on.has(t.key) ? "border-brand-500 bg-brand-50 font-medium text-brand-800" : "border-slate-200 text-slate-700")}>
              <input type="checkbox" checked={on.has(t.key)} onChange={() => toggle(t.key)} className="h-5 w-5 shrink-0 rounded border-slate-300 accent-[#213f72]" />
              <span className="min-w-0 break-words">{t.label}</span>
            </label>
          ))}
        </div>
      </div>
      {ticked.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ticked.map((t) => {
            const opts = data.options[t.key] ?? [];
            return (
              <div key={t.key}>
                <label htmlFor={`vendor_${t.key}`} className="mb-1 block text-sm font-medium text-slate-700">{t.label} vendor</label>
                <Select id={`vendor_${t.key}`} name={`vendor_${t.key}`} defaultValue={data.chosen?.[t.key] ?? ""}>
                  <option value="">{opts.length ? "— Choose vendor —" : "No vendor for this work yet"}</option>
                  {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                {!opts.length && <p className="mt-1 text-xs text-amber-700">Add one under Procurement → Vendors (tick “{t.label}”), then choose it here.</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
