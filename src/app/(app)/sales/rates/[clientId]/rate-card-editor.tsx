"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { BOQ_CATEGORY_OPTS, UNIT_OPTS } from "@/lib/enums";
import type { ActionResult } from "@/lib/action";

type Row = { name: string; unit: string; category: string; rate: number | "" };
const v = (x: number | "") => (x === "" ? 0 : Number(x));

/** A client's saved rates: the rate DSC quotes for each item (profit already in it). */
export function RateCardEditor({ initial, editable, save }: { initial: Row[]; editable: boolean; save: (profit: number, json: string) => Promise<ActionResult> }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = React.useState<Row[]>(initial);
  const [dirty, setDirty] = React.useState(false);
  const [pending, start] = React.useTransition();

  const edit = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  function doSave() {
    const payload = rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name, unit: r.unit, category: r.category, rate: v(r.rate), materialRate: 0, labourRate: 0, otherRate: 0 }));
    start(async () => {
      const r = await save(0, JSON.stringify(payload));
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        setDirty(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rates ({rows.length})</CardTitle>
        {editable && (
          <div className="flex items-center gap-2">
            {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
            <Button size="sm" onClick={doSave} loading={pending} disabled={!dirty}><Save className="h-4 w-4" /> Save</Button>
          </div>
        )}
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-2 py-2 text-left">Item</th><th className="w-32 px-1 py-2 text-left">Category</th><th className="w-20 px-1 py-2 text-left">Unit</th><th className="w-32 px-1 py-2 text-right">Rate</th>{editable && <th className="w-8" />}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-2 py-1.5"><Input value={r.name} disabled={!editable} onChange={(e) => edit(i, { name: e.target.value })} placeholder="e.g. Vitrified tile 600x600" className="h-8 px-2 text-xs" aria-label={`Item ${i + 1}`} /></td>
                <td className="px-1 py-1.5"><Select value={r.category} disabled={!editable} onChange={(e) => edit(i, { category: e.target.value })} className="h-8 px-2 text-xs">{BOQ_CATEGORY_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></td>
                <td className="px-1 py-1.5"><Select value={r.unit} disabled={!editable} onChange={(e) => edit(i, { unit: e.target.value })} className="h-8 px-2 text-xs">{UNIT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></td>
                <td className="px-1 py-1.5"><Input type="number" min="0" step="any" inputMode="decimal" value={r.rate} disabled={!editable} aria-label={`Rate ${i + 1}`} onChange={(e) => edit(i, { rate: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8 px-2 text-right text-xs" /></td>
                {editable && <td className="px-1 py-1.5"><button onClick={() => { setRows((rs) => rs.filter((_, k) => k !== i)); setDirty(true); }} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove rate ${i + 1}`}><Trash2 className="h-3.5 w-3.5" /></button></td>}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">No rates yet. Add them here, or type the rates in a BOQ for this client and press <b>Save rates</b>.</td></tr>}
          </tbody>
        </table>
      </div>
      {editable && (
        <CardBody className="border-t border-slate-100 py-3">
          <Button size="sm" variant="secondary" onClick={() => { setRows((rs) => [...rs, { name: "", unit: rs.at(-1)?.unit ?? "sqft", category: rs.at(-1)?.category ?? "OTHER", rate: "" }]); setDirty(true); }}><Plus className="h-4 w-4" /> Add rate</Button>
        </CardBody>
      )}
    </Card>
  );
}
