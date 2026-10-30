"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, Ruler, Calculator, BookmarkPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { boqItemTotals, boqSummary } from "@/lib/money";
import { basisFor, blankLine, finalQty, lineProblem, lineValue, type MeasureLine } from "@/lib/measure";
import { cn, formatINR, humanize } from "@/lib/utils";
import { sellFromCost } from "@/lib/rate-card";
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
  lines: MeasureLine[]; // site measurement sheet; when not empty the quantity is calculated from it
  // kept from a client's own BOQ and passed back on save untouched
  subcategory?: string;
  package?: string;
  ref?: string;
  remarks?: string;
  code?: string;
  hsn?: string;
  rateNote?: string; // where the app took this rate from, when it was not an exact match: cleared once someone looks at it
  auto?: boolean; // selling rate follows cost + profit % until someone types a selling rate by hand
};

let n = 0;
const blank = (category = "OTHER"): EditorItem => ({ key: `n${Date.now()}_${n++}`, category, item: "", specification: "", unit: "nos", quantity: 1, materialCost: 0, labourCost: 0, otherCost: 0, sellingRate: 0, lines: [] });
const toEditorItem = (i: Omit<EditorItem, "key">): EditorItem => ({ ...i, key: i.id ?? `n${Date.now()}_${n++}` });
const v = (x: number | "") => (x === "" ? 0 : Number(x));
const qtyOf = (r: EditorItem) => (r.lines.length ? finalQty(r.lines, r.unit) : v(r.quantity));

export function BoqEditor({
  initial,
  canCosts,
  editable,
  save,
  catalog,
  profitPct,
  clientName,
  saveRates,
}: {
  initial: Omit<EditorItem, "key">[];
  canCosts: boolean;
  editable: boolean;
  save: (json: string, profitPct: number | null) => Promise<ActionResult>;
  catalog: { id: string; name: string; unit: string; cost: number }[];
  profitPct: number | null;
  clientName: string | null;
  saveRates: ((profitPct: number) => Promise<ActionResult>) | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [profit, setProfit] = React.useState<number | "">(profitPct ?? "");
  const [rows, setRows] = React.useState<EditorItem[]>(() =>
    initial.map((i) => {
      const cost = v(i.materialCost) + v(i.labourCost) + v(i.otherCost);
      return { ...toEditorItem(i), auto: v(i.sellingRate) === 0 || (profitPct !== null && cost > 0 && v(i.sellingRate) === sellFromCost(cost, profitPct)) };
    }),
  );
  const [dirty, setDirty] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const listId = React.useId();

  const costOf = (r: EditorItem) => v(r.materialCost) + v(r.labourCost) + v(r.otherCost);
  /** while a row is "auto", its selling rate is always cost + profit % */
  const priced = (r: EditorItem, p: number | ""): EditorItem => (r.auto && p !== "" && costOf(r) > 0 ? { ...r, sellingRate: sellFromCost(costOf(r), p) } : r);
  const set = (key: string, patch: Partial<EditorItem>) => {
    const manual = "sellingRate" in patch;
    const rateTouched = ["materialCost", "labourCost", "otherCost", "sellingRate"].some((k) => k in patch); // a person looked at the rate
    setRows((rs) => rs.map((r) => (r.key === key ? priced({ ...r, ...patch, ...(manual ? { auto: false } : {}), ...(rateTouched ? { rateNote: undefined } : {}) }, profit) : r)));
    setDirty(true);
  };
  const changeProfit = (p: number | "") => {
    setProfit(p);
    setRows((rs) => rs.map((r) => priced(r, p)));
    setDirty(true);
  };
  const priceAll = () => {
    if (profit === "") return;
    setRows((rs) => rs.map((r) => (costOf(r) > 0 ? priced({ ...r, auto: true }, profit) : r)));
    setDirty(true);
  };

  const calc = rows.map((r) => boqItemTotals({ quantity: qtyOf(r), materialCost: v(r.materialCost), labourCost: v(r.labourCost), otherCost: v(r.otherCost), sellingRate: v(r.sellingRate) }));
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
      .filter((r) => r.item.trim() || v(r.sellingRate) || qtyOf(r) > 0)
      .map(({ key: _k, auto: _a, lines, ...r }) => ({ ...r, quantity: lines.length ? finalQty(lines, r.unit) : v(r.quantity), measurements: lines.length ? { lines } : null, materialCost: v(r.materialCost), labourCost: v(r.labourCost), otherCost: v(r.otherCost), sellingRate: v(r.sellingRate) }));
    start(async () => {
      const r = await save(JSON.stringify(payload), profit === "" ? null : profit);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        setDirty(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  function doSaveRates() {
    if (!saveRates || profit === "") return;
    const payload = rows
      .filter((r) => r.item.trim() || v(r.sellingRate) || qtyOf(r) > 0)
      .map(({ key: _k, auto: _a, lines, ...r }) => ({ ...r, quantity: lines.length ? finalQty(lines, r.unit) : v(r.quantity), measurements: lines.length ? { lines } : null, materialCost: v(r.materialCost), labourCost: v(r.labourCost), otherCost: v(r.otherCost), sellingRate: v(r.sellingRate) }));
    start(async () => {
      const saved = await save(JSON.stringify(payload), profit); // the rates come from the saved rows, so save first
      if (!saved.ok) return void toast.error(saved.error);
      const r = await saveRates(profit);
      if (r.ok) {
        toast.success(r.message ?? "Rates saved");
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

      {canCosts && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium text-slate-700">
                Profit added on cost{clientName ? ` for ${clientName}` : ""}
                <span className="mt-1 flex items-center gap-2">
                  <Input type="number" min="0" max="500" step="any" inputMode="decimal" value={profit} disabled={!editable} onChange={(e) => changeProfit(e.target.value === "" ? "" : Number(e.target.value))} className="h-10 w-28 text-right" aria-label="Profit percent" />
                  <span className="text-sm text-slate-500">%</span>
                </span>
              </label>
              {editable && <Button size="sm" variant="secondary" onClick={priceAll} disabled={profit === ""}><Calculator className="h-4 w-4" /> Calculate selling rates for all rows</Button>}
              {editable && saveRates && <Button size="sm" variant="secondary" onClick={doSaveRates} loading={pending} disabled={profit === ""}><BookmarkPlus className="h-4 w-4" /> Remember these rates for {clientName}</Button>}
            </div>
            <p className="text-xs text-slate-500">
              Type DSC&apos;s cost <b>per unit</b> (for example per sq ft) in Material, Labour and Other. The selling rate, the row total, the profit and the BOQ total are worked out for you. Typing a selling rate yourself switches that row to manual.
            </p>
          </CardBody>
        </Card>
      )}

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
                      <td className="px-1 pt-1.5 align-top"><Input value={r.item} list={listId} disabled={!editable} onChange={(e) => onItem(r, e.target.value)} placeholder="Item name" className="h-8 px-2 text-xs" aria-label={`Item ${i + 1}`} />
                        {canCosts && r.rateNote && <p className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-[11px] leading-snug text-amber-800"><b>Check:</b> {r.rateNote}{editable && <button type="button" className="ml-1 font-semibold text-amber-900 underline" onClick={() => { setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, rateNote: undefined } : x))); setDirty(true); }}>OK</button>}</p>}
                      </td>
                      <td className="px-1 pt-1.5 align-top">
                        <Select value={r.unit} disabled={!editable} onChange={(e) => set(r.key, { unit: e.target.value })} className="h-8 px-2 text-xs">
                          {UNIT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      </td>
                      <td className="px-1 pt-1.5 align-top">
                        {r.lines.length ? <Input readOnly value={qtyOf(r)} aria-label={`Quantity ${i + 1} (from measurements)`} title="Calculated from the measurement sheet" className="h-8 cursor-default bg-brand-50 px-2 text-right text-xs font-semibold text-brand-900" />
                          : num({ value: r.quantity, onChange: (x) => set(r.key, { quantity: x }), label: `Quantity ${i + 1}` })}
                      </td>
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
                        <div className="flex items-center gap-2">
                          <Input value={r.specification} disabled={!editable} onChange={(e) => set(r.key, { specification: e.target.value })} placeholder="Specification / brand / finish (optional)" className="h-7 flex-1 border-dashed px-2 text-xs" aria-label={`Specification ${i + 1}`} />
                          {(editable || r.lines.length > 0) && (
                            <button type="button" onClick={() => setOpen((o) => { const n2 = new Set(o); if (n2.has(r.key)) n2.delete(r.key); else n2.add(r.key); return n2; })}
                              className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium", r.lines.length ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-300 text-slate-600 hover:bg-slate-50")} aria-expanded={open.has(r.key)}>
                              <Ruler className="h-3.5 w-3.5" /> {r.lines.length ? `Measured (${r.lines.length})` : "Measure"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open.has(r.key) && (
                      <tr>
                        <td />
                        <td colSpan={canCosts ? 10 : 6} className="px-1 pb-3">
                          <MeasurePanel unit={r.unit} lines={r.lines} editable={editable} onChange={(lines) => set(r.key, { lines })} />
                        </td>
                      </tr>
                    )}
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


/** Feet + inches measurement sheet for one BOQ item, with "less" (deduction) rows. */
function MeasurePanel({ unit, lines, editable, onChange }: { unit: string; lines: MeasureLine[]; editable: boolean; onChange: (l: MeasureLine[]) => void }) {
  const basis = basisFor(unit);
  const total = finalQty(lines, unit);
  const edit = (idx: number, patch: Partial<MeasureLine>) => onChange(lines.map((l, k) => (k === idx ? { ...l, ...patch } : l)));
  const blankIfZero = (x: number) => (x === 0 ? "" : x);
  const numIn = (value: number, on: (x: number) => void, label: string, w = "w-16") => (
    <Input type="number" min="0" step="any" inputMode="decimal" value={blankIfZero(value)} disabled={!editable} aria-label={label} onChange={(e) => on(e.target.value === "" ? 0 : Number(e.target.value))} className={cn("h-8 px-2 text-right text-xs", w)} />
  );
  const hint = basis === "AREA" ? `Length x width x qty gives ${unit}.` : basis === "LENGTH" ? `Length x qty gives ${unit}.` : `Only the number of pieces is used for ${unit}.`;
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-800">Measurement sheet <span className="font-normal text-slate-500">· {hint} Tick <b>Less</b> to deduct (openings, stairs, other finish).</span></p>
        <p className="text-sm font-semibold text-brand-900">Final quantity: {total} {unit}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-1 py-1">Description</th>
              {basis !== "COUNT" && <th className="px-1 py-1 text-center" colSpan={2}>Length (ft / in)</th>}
              {basis === "AREA" && <th className="px-1 py-1 text-center" colSpan={2}>Width (ft / in)</th>}
              <th className="px-1 py-1 text-right">Qty</th><th className="px-1 py-1 text-center">Less</th><th className="px-1 py-1 text-right">{unit}</th><th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const problem = lineProblem(l, unit);
              return (
                <React.Fragment key={idx}>
                  <tr>
                    <td className="px-1 py-1"><Input value={l.desc ?? ""} disabled={!editable} onChange={(e) => edit(idx, { desc: e.target.value })} placeholder="e.g. Hall, Bedroom 1" className="h-8 min-w-36 px-2 text-xs" aria-label={`Line ${idx + 1} description`} /></td>
                    {basis !== "COUNT" && <><td className="px-1 py-1">{numIn(l.lenFt, (x) => edit(idx, { lenFt: x }), `Line ${idx + 1} length feet`)}</td><td className="px-1 py-1">{numIn(l.lenIn, (x) => edit(idx, { lenIn: x }), `Line ${idx + 1} length inches`, "w-14")}</td></>}
                    {basis === "AREA" && <><td className="px-1 py-1">{numIn(l.widFt, (x) => edit(idx, { widFt: x }), `Line ${idx + 1} width feet`)}</td><td className="px-1 py-1">{numIn(l.widIn, (x) => edit(idx, { widIn: x }), `Line ${idx + 1} width inches`, "w-14")}</td></>}
                    <td className="px-1 py-1">{numIn(l.qty, (x) => edit(idx, { qty: x }), `Line ${idx + 1} quantity`, "w-14")}</td>
                    <td className="px-1 py-1 text-center"><input type="checkbox" checked={l.less} disabled={!editable} onChange={(e) => edit(idx, { less: e.target.checked })} aria-label={`Line ${idx + 1} is a deduction`} className="h-4 w-4 accent-red-600" /></td>
                    <td className={cn("tabular px-1 py-1 text-right font-medium", l.less ? "text-red-600" : "text-slate-900")}>{Math.round(lineValue(l, unit) * 1000) / 1000}</td>
                    <td className="px-1 py-1">{editable && <button type="button" onClick={() => onChange(lines.filter((_, k) => k !== idx))} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove line ${idx + 1}`}><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                  </tr>
                  {problem && editable && <tr><td colSpan={9} className="px-1 pb-1 text-[11px] font-medium text-red-600">{problem}</td></tr>}
                </React.Fragment>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={9} className="px-1 py-3 text-center text-slate-500">No measurement lines yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...lines, blankLine()])}><Plus className="h-4 w-4" /> Add line</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...lines, { ...blankLine(), less: true }])}>Add a deduction</Button>
          {lines.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>Remove measurement sheet (type quantity by hand)</Button>}
        </div>
      )}
    </div>
  );
}
