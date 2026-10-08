"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { boqItemTotals, boqSummary } from "@/lib/money";
import { cn, formatINR, humanize } from "@/lib/utils";
import { BOQ_CATEGORY_OPTS, UNIT_OPTS } from "@/lib/enums";
import type { ActionResult } from "@/lib/action";

export type EditorItem = {
  key: string;
  id?: string;
  category: string;
  item: string;
  specification: string;
  unit: string;
  quantity: number | "";
  materialCost: number | "";
  labourCost: number | "";
  otherCost: number | "";
  sellingRate: number | "";
  materialId?: string | null;
};

let n = 0;
const blank = (category = "OTHER"): EditorItem => ({ key: `n${Date.now()}_${n++}`, category, item: "", specification: "", unit: "nos", quantity: 1, materialCost: 0, labourCost: 0, otherCost: 0, sellingRate: 0 });
export const toEditorItem = (i: Omit<EditorItem, "key">): EditorItem => ({ ...i, key: i.id ?? `n${Date.now()}_${n++}` });
const v = (x: number | "") => (x === "" ? 0 : Number(x));

export function BoqEditor({
  initial,
  canCosts,
  editable,
  save,
  catalog,
}: {
  initial: EditorItem[];
  canCosts: boolean;
  editable: boolean;
  save: (json: string) => Promise<ActionResult>;
  catalog: { id: string; name: string; unit: string; cost: number }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = React.useState<EditorItem[]>(initial);
  const [dirty, setDirty] = React.useState(false);
  const [pending, start] = React.useTransition();
  const listId = React.useId();

  const set = (key: string, patch: Partial<EditorItem>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const calc = rows.map((r) => boqItemTotals({ quantity: v(r.quantity), materialCost: v(r.materialCost), labourCost: v(r.labourCost), otherCost: v(r.otherCost), sellingRate: v(r.sellingRate) }));
  const sum = boqSummary(calc);
  const byCat = new Map<string, { cost: number; total: number; count: number }>();
  rows.forEach((r, i) => {
    const x = byCat.get(r.category) ?? { cost: 0, total: 0, count: 0 };
    x.cost += calc[i].estimatedCost;
    x.total += calc[i].total;
    x.count++;
    byCat.set(r.category, x);
  });

  function onItem(r: EditorItem, value: string) {
    const hit = catalog.find((c) => c.name.toLowerCase() === value.toLowerCase());
    if (hit) set(r.key, { item: value, materialId: hit.id, unit: hit.unit, materialCost: canCosts && !v(r.materialCost) ? hit.cost : r.materialCost });
    else set(r.key, { item: value, materialId: null });
  }

  function doSave() {
    const payload = rows
      .filter((r) => r.item.trim() || v(r.sellingRate) || v(r.quantity) > 0)
      .map(({ key: _k, ...r }) => ({ ...r, quantity: v(r.quantity), materialCost: v(r.materialCost), labourCost: v(r.labourCost), otherCost: v(r.otherCost), sellingRate: v(r.sellingRate) }));
    start(async () => {
      const r = await save(JSON.stringify(payload));
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        setDirty(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  const num = (props: { value: number | ""; onChange: (x: number | "") => void; label: string; w?: string }) => (
    <Input type="number" min="0" step="any" value={props.value} disabled={!editable} aria-label={props.label}
      onChange={(e) => props.onChange(e.target.value === "" ? "" : Number(e.target.value))} className={cn("h-8 px-2 text-right text-xs", props.w)} />
  );

  return (
    <div className="space-y-5">
      <div className={cn("grid gap-3", canCosts ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-2")}>
        {canCosts && <Tile label="Estimated cost" value={formatINR(sum.cost)} />}
        <Tile label="Selling total (excl. GST)" value={formatINR(sum.revenue)} />
        {canCosts && <Tile label="Gross margin" value={formatINR(sum.margin)} tone={sum.margin < 0 ? "bad" : "good"} />}
        {canCosts && <Tile label="Margin %" value={`${sum.marginPct.toFixed(1)}%`} tone={sum.marginPct < 15 ? "bad" : "good"} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items ({rows.length})</CardTitle>
          {editable && (
            <div className="flex items-center gap-2">
              {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
              <Button size="sm" onClick={doSave} loading={pending} disabled={!dirty}><Save className="h-4 w-4" /> Save</Button>
            </div>
          )}
        </CardHeader>
        <datalist id={listId}>{catalog.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <div className="overflow-x-auto">
          <table className={cn("w-full text-sm", canCosts ? "min-w-[1100px]" : "min-w-[760px]")}>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2 text-left">#</th>
                <th className="w-32 px-1 py-2 text-left">Category</th>
                <th className="px-1 py-2 text-left">Item</th>
                <th className="w-20 px-1 py-2 text-left">Unit</th>
                <th className="w-20 px-1 py-2 text-right">Qty</th>
                {canCosts && <><th className="w-24 px-1 py-2 text-right">Material/unit</th><th className="w-24 px-1 py-2 text-right">Labour/unit</th><th className="w-24 px-1 py-2 text-right">Other/unit</th></>}
                <th className="w-28 px-1 py-2 text-right">Sell rate</th>
                {canCosts && <th className="w-28 px-2 py-2 text-right">Est. cost</th>}
                <th className="w-28 px-2 py-2 text-right">Total</th>
                {canCosts && <th className="w-16 px-2 py-2 text-right">Margin</th>}
                {editable && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const m = calc[i].total > 0 ? ((calc[i].total - calc[i].estimatedCost) / calc[i].total) * 100 : 0;
                return (
                  <React.Fragment key={r.key}>
                    <tr className="border-t border-slate-100">
                      <td className="px-2 pt-2 align-top text-slate-400">{i + 1}</td>
                      <td className="px-1 pt-1.5 align-top">
                        <Select value={r.category} disabled={!editable} onChange={(e) => set(r.key, { category: e.target.value })} className="h-8 px-2 text-xs">
                          {BOQ_CATEGORY_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      </td>
                      <td className="px-1 pt-1.5 align-top"><Input value={r.item} list={listId} disabled={!editable} onChange={(e) => onItem(r, e.target.value)} placeholder="Item name" className="h-8 px-2 text-xs" aria-label={`Item ${i + 1}`} /></td>
                      <td className="px-1 pt-1.5 align-top">
                        <Select value={r.unit} disabled={!editable} onChange={(e) => set(r.key, { unit: e.target.value })} className="h-8 px-2 text-xs">
                          {UNIT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      </td>
                      <td className="px-1 pt-1.5 align-top">{num({ value: r.quantity, onChange: (x) => set(r.key, { quantity: x }), label: `Quantity ${i + 1}` })}</td>
                      {canCosts && (
                        <>
                          <td className="px-1 pt-1.5 align-top">{num({ value: r.materialCost, onChange: (x) => set(r.key, { materialCost: x }), label: `Material cost ${i + 1}` })}</td>
                          <td className="px-1 pt-1.5 align-top">{num({ value: r.labourCost, onChange: (x) => set(r.key, { labourCost: x }), label: `Labour cost ${i + 1}` })}</td>
                          <td className="px-1 pt-1.5 align-top">{num({ value: r.otherCost, onChange: (x) => set(r.key, { otherCost: x }), label: `Other cost ${i + 1}` })}</td>
                        </>
                      )}
                      <td className="px-1 pt-1.5 align-top">{num({ value: r.sellingRate, onChange: (x) => set(r.key, { sellingRate: x }), label: `Selling rate ${i + 1}` })}</td>
                      {canCosts && <td className="tabular px-2 pt-3 text-right align-top text-xs text-slate-600">{formatINR(calc[i].estimatedCost)}</td>}
                      <td className="tabular px-2 pt-3 text-right align-top text-xs font-medium text-slate-900">{formatINR(calc[i].total)}</td>
                      {canCosts && <td className={cn("tabular px-2 pt-3 text-right align-top text-xs", m < 10 ? "font-medium text-red-600" : "text-emerald-700")}>{calc[i].total ? `${m.toFixed(0)}%` : "—"}</td>}
                      {editable && (
                        <td className="px-1 pt-1.5 align-top">
                          <button onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setDirty(true); }} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove item ${i + 1}`}><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      )}
                    </tr>
                    <tr>
                      <td />
                      <td colSpan={canCosts ? 10 : 6} className="px-1 pb-1.5">
                        <Input value={r.specification} disabled={!editable} onChange={(e) => set(r.key, { specification: e.target.value })} placeholder="Specification / brand / finish (optional)" className="h-7 border-dashed px-2 text-xs" aria-label={`Specification ${i + 1}`} />
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={12} className="px-4 py-10 text-center text-sm text-slate-500">No items yet. {editable ? "Add a row or import from Excel." : ""}</td></tr>}
            </tbody>
          </table>
        </div>
        {editable && (
          <CardBody className="border-t border-slate-100 py-3">
            <Button size="sm" variant="secondary" onClick={() => { setRows((rs) => [...rs, blank(rs.at(-1)?.category)]); setDirty(true); }}><Plus className="h-4 w-4" /> Add row</Button>
          </CardBody>
        )}
      </Card>

      {byCat.size > 0 && (
        <Card>
          <CardHeader><CardTitle>By category</CardTitle></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2 text-left">Category</th><th className="px-4 py-2 text-right">Items</th>{canCosts && <th className="px-4 py-2 text-right">Est. cost</th>}<th className="px-4 py-2 text-right">Selling</th>{canCosts && <th className="px-4 py-2 text-right">Margin</th>}</tr>
              </thead>
              <tbody>
                {[...byCat.entries()].map(([cat, x]) => (
                  <tr key={cat} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium">{humanize(cat)}</td>
                    <td className="tabular px-4 py-2 text-right">{x.count}</td>
                    {canCosts && <td className="tabular px-4 py-2 text-right">{formatINR(x.cost)}</td>}
                    <td className="tabular px-4 py-2 text-right">{formatINR(x.total)}</td>
                    {canCosts && <td className="tabular px-4 py-2 text-right">{x.total ? `${(((x.total - x.cost) / x.total) * 100).toFixed(1)}%` : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className={cn("rounded-xl border bg-white p-4 shadow-sm", tone === "good" && "border-l-4 border-l-emerald-500", tone === "bad" && "border-l-4 border-l-red-500", !tone && "border-slate-200")}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
