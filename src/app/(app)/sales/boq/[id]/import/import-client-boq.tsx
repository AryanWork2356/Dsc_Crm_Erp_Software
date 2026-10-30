"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { humanize } from "@/lib/utils";
import { importClientBoq, previewClientBoq } from "../../actions";

type Sheet = {
  name: string; measurement: boolean; hidden: boolean; headerRow: number; columns: Record<string, string>; count: number; skipped: number; sections: string[]; warnings: string[]; flagged: number; withRates: number; repeats: string | null;
  categories: Record<string, number>; sample: { row: number; sl: string; category: string; item: string; unit: string; quantity: number; rate: number | null; flags: string[] }[];
};

export function ImportClientBoq({ boqId, hasItems, canKeepRates }: { boqId: string; hasItems: boolean; canKeepRates: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [file, setFile] = React.useState<File | null>(null);
  const [sheets, setSheets] = React.useState<Sheet[] | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState<"append" | "replace">("append");
  const [keepRates, setKeepRates] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  function read() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    setError(null);
    start(async () => {
      const r = await previewClientBoq(fd);
      if (r.ok) {
        const found = (r.data as { sheets: Sheet[] }).sheets;
        setSheets(found);
        // a measurement sheet is not a price list, and a sheet that repeats an earlier one would bring every item twice: not ticked
        setPicked(new Set(found.filter((s) => !s.measurement && !s.hidden && !s.repeats).map((s) => s.name)));
      } else setError(r.error);
    });
  }

  function save() {
    if (!file || !sheets) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("sheets", [...picked].join("|"));
    fd.set("mode", mode);
    if (keepRates) fd.set("keepRates", "on");
    setError(null);
    start(async () => {
      const r = await importClientBoq(boqId, fd);
      if (r.ok) {
        toast.success(r.message ?? "Imported");
        router.push(`/sales/boq/${boqId}`);
        router.refresh();
      } else setError(r.error);
    });
  }

  const total = sheets?.filter((s) => picked.has(s.name)).reduce((n, s) => n + s.count, 0) ?? 0;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>1. Choose the client&apos;s Excel file</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">Any layout works. The app finds the table, the columns (description, unit, quantity, rate) and the section headings by itself, and shows you what it found <b>before anything is saved</b>.</p>
          <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSheets(null); setError(null); }} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white" />
          <Button onClick={read} loading={pending && !sheets} disabled={!file}>Read the file</Button>
        </CardBody>
      </Card>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

      {sheets && (
        <>
          <Card>
            <CardHeader><CardTitle>2. What the app found – tick what to import</CardTitle></CardHeader>
            <div className="divide-y divide-slate-100">
              {sheets.map((s) => (
                <div key={s.name} className="p-5">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-700" checked={picked.has(s.name)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(s.name); else n.delete(s.name); return n; })} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900"><FileSpreadsheet className="h-4 w-4 text-slate-400" /> {s.name} <Badge tone="blue">{s.count} items</Badge>{s.withRates > 0 && <Badge tone="teal">{s.withRates} with rates</Badge>}{s.measurement && <Badge tone="slate">measurement sheet – not ticked</Badge>}{s.hidden && <Badge tone="slate">hidden in the file – not ticked</Badge>}{s.flagged > 0 && <Badge tone="amber">{s.flagged} to check</Badge>}{s.repeats && <Badge tone="amber">same items as “{s.repeats}” – not ticked</Badge>}</span>
                      <span className="mt-1 block text-xs text-slate-500">Header on row {s.headerRow} · columns: {Object.entries(s.columns).filter(([, v]) => v !== "—").map(([k, v]) => `${k} = ${v}`).join(", ")}{s.skipped ? ` · ${s.skipped} total/blank line(s) ignored` : ""}</span>
                      {s.sections.length > 0 && <span className="mt-1 block text-xs text-slate-500">Sections: {s.sections.join(", ")}</span>}
                      <span className="mt-1 flex flex-wrap gap-1">{Object.entries(s.categories).map(([k, v]) => <Badge key={k} tone="slate">{humanize(k)} {v}</Badge>)}</span>
                      {s.repeats && <span className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> This sheet repeats most items of “{s.repeats}” (for example another version of the same work, or where the quantities are worked out). Tick only the one you are quoting, or the items come in twice.</span>}
                      {s.warnings.map((w) => <span key={w} className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {w}</span>)}
                    </span>
                  </label>
                  <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-1.5">Row</th><th className="px-2 py-1.5">Ref</th><th className="px-2 py-1.5">Category</th><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5">Unit</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Rate</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {s.sample.map((i) => (
                          <tr key={i.row} className={i.flags.length ? "bg-amber-50" : ""} title={i.flags.join("; ")}>
                            <td className="px-2 py-1.5 text-slate-400">{i.row}</td><td className="px-2 py-1.5">{i.sl}</td><td className="px-2 py-1.5">{humanize(i.category)}</td>
                            <td className="max-w-xs truncate px-2 py-1.5 text-slate-900">{i.item}{i.flags.length > 0 && <span className="ml-1 font-medium text-amber-700">⚠ {i.flags[0]}</span>}</td>
                            <td className="px-2 py-1.5">{i.unit}</td><td className="tabular px-2 py-1.5 text-right">{i.quantity}</td><td className="tabular px-2 py-1.5 text-right text-slate-500">{i.rate ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {s.count > s.sample.length && <p className="mt-1 text-xs text-slate-500">…and {s.count - s.sample.length} more rows.</p>}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>3. Import</CardTitle></CardHeader>
            <CardBody className="space-y-3 text-sm">
              {hasItems && (
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "append"} onChange={() => setMode("append")} /> Add to the items already in this BOQ</label>
                  <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace all items in this BOQ</label>
                </div>
              )}
              {canKeepRates && <label className="flex items-center gap-2"><input type="checkbox" checked={keepRates} onChange={(e) => setKeepRates(e.target.checked)} className="h-4 w-4 accent-brand-700" /> Keep the rates written in the client&apos;s file (otherwise rates stay empty for DSC to fill in)</label>}
              <p className="text-slate-600">After importing you fill in DSC&apos;s rates on the BOQ page, then create the quotation. Rows marked ⚠ were adjusted (for example a quantity like &quot;RO&quot; becomes 0): check them.</p>
              <Button onClick={save} loading={pending} disabled={picked.size === 0 || total === 0}>Import {total} items</Button>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
