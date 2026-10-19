"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { BOQ_CATEGORY_OPTS, UNIT_OPTS } from "@/lib/enums";
import { sellFromCost } from "@/lib/rate-card";
import { cn, formatINR } from "@/lib/utils";
import type { ActionResult } from "@/lib/action";

type Row = { name: string; unit: string; category: string; materialRate: number | ""; labourRate: number | ""; otherRate: number | "" };
const v = (x: number | "") => (x === "" ? 0 : Number(x));

export function RateCardEditor({ initial, profitPct, editable, save }: { initial: Row[]; profitPct: number; editable: boolean; save: (profit: number, json: string) => Promise<ActionResult> }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = React.useState<Row[]>(initial);
  const [profit, setProfit] = React.useState<number | "">(profitPct);
  const [dirty, setDirty] = React.useState(false);
  const [pending, start] = React.useTransition();

  const edit = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const numIn = (value: number | "", on: (x: number | "") => void, label: string) => (
    <Input type="number" min="0" step="any" inputMode="decimal" value={value} disabled={!editable} aria-label={label} onChange={(e) => on(e.target.value === "" ? "" : Number(e.target.value))} className="h-8 px-2 text-right text-xs" />
  );

  function doSave() {
    if (profit === "") return void toast.error("Enter the profit %");
    const payload = rows.filter((r) => r.name.trim()).map((r) => ({ ...r, materialRate: v(r.materialRate), labourRate: v(r.labourRate), otherRate: v(r.otherRate) }));
    start(async () => {
      const r = await save(profit, JSON.stringify(payload));
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        setDirty(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex flex-wrap items-end justify-between gap-4">
          <label className="text-sm font-medium text-slate-700">
            Profit DSC adds on cost for this client
            <span className="mt-1 flex items-center gap-2">
              <Input type="number" min="0" max="500" step="any" inputMode="decimal" value={profit} disabled={!editable} onChange={(e) => { setProfit(e.target.value === "" ? "" : Number(e.target.value)); setDirty(true); }} className="h-10 w-28 text-right" aria-label="Profit percent" />
              <span className="text-sm text-slate-500">%</span>
            </span>
          </label>
          {editable && (
            <div className="flex items-center gap-2">
              {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
              <Button onClick={doSave} loading={pending} disabled={!dirty}><Save className="h-4 w-4" /> Save</Button>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Rates ({rows.length})</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Item</th><th className="w-32 px-1 py-2 text-left">Category</th><th className="w-20 px-1 py-2 text-left">Unit</th>
                <th className="w-24 px-1 py-2 text-right">Material/unit</th><th className="w-24 px-1 py-2 text-right">Labour/unit</th><th className="w-24 px-1 py-2 text-right">Other/unit</th>
                <th className="w-24 px-2 py-2 text-right">Cost/unit</th><th className="w-28 px-2 py-2 text-right">Selling/unit</th>{editable && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const cost = v(r.materialRate) + v(r.labourRate) + v(r.otherRate);
                return (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1.5"><Input value={r.name} disabled={!editable} onChange={(e) => edit(i, { name: e.target.value })} placeholder="e.g. Vitrified tile 600x600" className="h-8 px-2 text-xs" aria-label={`Item ${i + 1}`} /></td>
                    <td className="px-1 py-1.5"><Select value={r.category} disabled={!editable} onChange={(e) => edit(i, { category: e.target.value })} className="h-8 px-2 text-xs">{BOQ_CATEGORY_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></td>
                    <td className="px-1 py-1.5"><Select value={r.unit} disabled={!editable} onChange={(e) => edit(i, { unit: e.target.value })} className="h-8 px-2 text-xs">{UNIT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></td>
                    <td className="px-1 py-1.5">{numIn(r.materialRate, (x) => edit(i, { materialRate: x }), `Material rate ${i + 1}`)}</td>
                    <td className="px-1 py-1.5">{numIn(r.labourRate, (x) => edit(i, { labourRate: x }), `Labour rate ${i + 1}`)}</td>
                    <td className="px-1 py-1.5">{numIn(r.otherRate, (x) => edit(i, { otherRate: x }), `Other rate ${i + 1}`)}</td>
                    <td className="tabular px-2 py-1.5 text-right text-xs text-slate-600">{formatINR(cost)}</td>
                    <td className={cn("tabular px-2 py-1.5 text-right text-xs font-medium", cost ? "text-slate-900" : "text-slate-400")}>{profit === "" ? "—" : formatINR(sellFromCost(cost, profit))}</td>
                    {editable && (
                      <td className="px-1 py-1.5">
                        <button onClick={() => { setRows((rs) => rs.filter((_, k) => k !== i)); setDirty(true); }} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove rate ${i + 1}`}><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">No rates yet. Add them here, or fill a BOQ for this client and press <b>Remember these rates</b>.</td></tr>}
            </tbody>
          </table>
        </div>
        {editable && (
          <CardBody className="border-t border-slate-100 py-3">
            <Button size="sm" variant="secondary" onClick={() => { setRows((rs) => [...rs, { name: "", unit: rs.at(-1)?.unit ?? "sqft", category: rs.at(-1)?.category ?? "OTHER", materialRate: 0, labourRate: 0, otherRate: 0 }]); setDirty(true); }}><Plus className="h-4 w-4" /> Add rate</Button>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
