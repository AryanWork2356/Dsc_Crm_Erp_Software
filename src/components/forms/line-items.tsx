"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { computeTotals } from "@/lib/money";
import { formatINR } from "@/lib/utils";

export type LineRow = {
  key: string;
  category?: string;
  description: string;
  unit: string;
  quantity: number | "";
  rate: number | "";
  taxPercent: number | "";
  materialId?: string;
  boqItemId?: string;
};

export type CatalogItem = { id: string; name: string; unit: string; rate: number };
type Opt = { value: string; label: string };

let counter = 0;
export const newRow = (defaults: Partial<LineRow> = {}): LineRow => ({
  key: `r${Date.now()}_${counter++}`,
  description: "", unit: "nos", quantity: 1, rate: "", taxPercent: 18, ...defaults,
});

/**
 * Editable line-item table with live totals. Submits as hidden JSON inputs:
 *   items (array), discountPct. The server recomputes all amounts – never trust these numbers.
 */
export function LineItemsEditor({
  initial,
  units,
  categories,
  catalog,
  defaultTax = 18,
  discountPct: initialDiscount = 0,
  showDiscount = true,
  errors,
  extraTotals,
}: {
  initial: LineRow[];
  units: Opt[];
  categories?: Opt[];
  catalog?: CatalogItem[];
  defaultTax?: number;
  discountPct?: number;
  showDiscount?: boolean;
  errors?: string;
  extraTotals?: React.ReactNode;
}) {
  const [rows, setRows] = React.useState<LineRow[]>(initial.length ? initial : [newRow({ taxPercent: defaultTax, category: categories?.at(-1)?.value })]);
  const [disc, setDisc] = React.useState<number | "">(initialDiscount || "");

  const update = (key: string, patch: Partial<LineRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const num = (v: number | "") => (v === "" ? 0 : Number(v));

  const totals = computeTotals(
    rows.map((r) => ({ quantity: num(r.quantity), rate: num(r.rate), taxPercent: num(r.taxPercent) })),
    { pct: num(disc) },
  );

  function onDescription(r: LineRow, value: string) {
    const hit = catalog?.find((c) => c.name.toLowerCase() === value.toLowerCase());
    if (hit) update(r.key, { description: value, materialId: hit.id, unit: hit.unit, rate: r.rate === "" ? hit.rate : r.rate });
    else update(r.key, { description: value, materialId: undefined });
  }

  const listId = React.useId();
  const payload = rows
    .filter((r) => r.description.trim() || num(r.rate))
    .map(({ key: _k, ...r }) => ({ ...r, quantity: num(r.quantity), rate: num(r.rate), taxPercent: num(r.taxPercent) }));

  return (
    <div>
      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      <input type="hidden" name="discountPct" value={num(disc)} />
      {catalog && (
        <datalist id={listId}>
          {catalog.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-2 py-2 text-left">#</th>
              {categories && <th className="w-36 px-2 py-2 text-left">Category</th>}
              <th className="px-2 py-2 text-left">Description</th>
              <th className="w-24 px-2 py-2 text-left">Unit</th>
              <th className="w-24 px-2 py-2 text-right">Qty</th>
              <th className="w-32 px-2 py-2 text-right">Rate (₹)</th>
              <th className="w-20 px-2 py-2 text-right">GST %</th>
              <th className="w-32 px-2 py-2 text-right">Amount</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-slate-100 align-top">
                <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                {categories && (
                  <td className="px-1 py-1.5">
                    <Select value={r.category ?? ""} onChange={(e) => update(r.key, { category: e.target.value })} className="h-9">
                      {categories.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </Select>
                  </td>
                )}
                <td className="px-1 py-1.5">
                  <Input value={r.description} list={catalog ? listId : undefined} onChange={(e) => onDescription(r, e.target.value)} placeholder="Item description" className="h-9" aria-label={`Description ${i + 1}`} />
                </td>
                <td className="px-1 py-1.5">
                  <Select value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} className="h-9">
                    {units.map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </Select>
                </td>
                <td className="px-1 py-1.5">
                  <Input type="number" min="0" step="any" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value === "" ? "" : Number(e.target.value) })} className="h-9 text-right" aria-label={`Quantity ${i + 1}`} />
                </td>
                <td className="px-1 py-1.5">
                  <Input type="number" min="0" step="any" value={r.rate} onChange={(e) => update(r.key, { rate: e.target.value === "" ? "" : Number(e.target.value) })} className="h-9 text-right" aria-label={`Rate ${i + 1}`} />
                </td>
                <td className="px-1 py-1.5">
                  <Input type="number" min="0" max="100" step="any" value={r.taxPercent} onChange={(e) => update(r.key, { taxPercent: e.target.value === "" ? "" : Number(e.target.value) })} className="h-9 text-right" aria-label={`GST ${i + 1}`} />
                </td>
                <td className="tabular px-2 py-3 text-right font-medium text-slate-900">{formatINR(totals.lines[i]?.amount ?? 0, true)}</td>
                <td className="px-1 py-1.5">
                  <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove line ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors && <p className="mt-2 text-sm font-medium text-red-600">{errors}</p>}

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <Button type="button" variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newRow({ taxPercent: defaultTax, category: categories?.at(-1)?.value ?? rs.at(-1)?.category })])}>
          <Plus className="h-4 w-4" /> Add line
        </Button>
        <dl className="tabular w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatINR(totals.subtotal, true)}</dd></div>
          {showDiscount && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500">Discount %</dt>
              <dd className="flex items-center gap-2">
                <Input type="number" min="0" max="100" step="any" value={disc} onChange={(e) => setDisc(e.target.value === "" ? "" : Number(e.target.value))} className="h-8 w-20 text-right" aria-label="Discount percent" />
                <span className="w-24 text-right text-slate-600">− {formatINR(totals.discount, true)}</span>
              </dd>
            </div>
          )}
          <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd>{formatINR(totals.tax, true)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900"><dt>Total</dt><dd>{formatINR(totals.total, true)}</dd></div>
          {extraTotals}
        </dl>
      </div>
    </div>
  );
}
