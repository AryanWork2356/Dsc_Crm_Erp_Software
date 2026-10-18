"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn, humanize } from "@/lib/utils";
import type { Opt } from "@/lib/enums";
import { createTransfer } from "./actions";

type Line = { key: number; materialId: string; quantity: number | "" };
let k = 0;

export function TransferForm({ from, to, materials, stock, workers }: {
  from: Opt[]; to: Opt[]; materials: { id: string; name: string; unit: string }[];
  stock: { projectId: string; materialId: string; qty: number }[];
  workers: { id: string; name: string; trade: string; projectId: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [kind, setKind] = React.useState<"MATERIAL" | "MANPOWER">("MATERIAL");
  const [fromId, setFromId] = React.useState(from[0]?.value ?? "");
  const [toId, setToId] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([{ key: k++, materialId: "", quantity: "" }]);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  const here = (id: string) => stock.find((s) => s.projectId === fromId && s.materialId === id)?.qty ?? 0;
  const stocked = materials.filter((m) => here(m.id) > 0);
  const crew = workers.filter((w) => w.projectId === fromId);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("fromProjectId", fromId);
    fd.set("toProjectId", toId);
    if (f.get("reason")) fd.set("reason", String(f.get("reason")));
    fd.set("emergency", f.get("emergency") ? "on" : "off");
    fd.set("items", JSON.stringify(kind === "MATERIAL" ? lines.filter((l) => l.materialId).map((l) => ({ materialId: l.materialId, quantity: Number(l.quantity) || 0 })) : [...picked].map((workerId) => ({ workerId }))));
    setError(null);
    start(async () => {
      const r = await createTransfer(fd);
      if (r.ok) {
        toast.success(r.message ?? "Done");
        router.push("/transfers");
        router.refresh();
      } else setError(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.error);
    });
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {(["MATERIAL", "MANPOWER"] as const).map((x) => (
          <button key={x} type="button" onClick={() => setKind(x)} aria-pressed={kind === x}
            className={cn("rounded-xl border-2 px-4 py-4 text-left transition", kind === x ? "border-brand-600 bg-brand-50 text-brand-900" : "border-slate-200 bg-white text-slate-700")}>
            <span className="block text-base font-semibold">{x === "MATERIAL" ? "Material" : "Workers"}</span>
            <span className="text-xs opacity-80">{x === "MATERIAL" ? "Stock from one site store to another" : "Move workers to another site"}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Between which projects?</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Moving FROM" required><Select value={fromId} onChange={(e) => { setFromId(e.target.value); setPicked(new Set()); }} required>{from.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
          <Field label="Moving TO" required><Select value={toId} onChange={(e) => setToId(e.target.value)} required><option value="">Choose project…</option>{to.filter((p) => p.value !== fromId).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
        </CardBody>
      </Card>

      {kind === "MATERIAL" ? (
        <Card>
          <CardHeader><CardTitle>Material</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            {stocked.length === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This project has no material in its site store to move.</p>}
            {lines.map((l, i) => (
              <div key={l.key} className="flex flex-wrap items-end gap-2">
                <Field label={i === 0 ? "Material" : ""} className="min-w-52 flex-1">
                  <Select value={l.materialId} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, materialId: e.target.value } : x)))}>
                    <option value="">Choose material…</option>
                    {stocked.map((m) => <option key={m.id} value={m.id}>{m.name} ({here(m.id)} {m.unit} on site)</option>)}
                  </Select>
                </Field>
                <Field label={i === 0 ? "Quantity" : ""} className="w-32"><Input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value === "" ? "" : Number(e.target.value) } : x)))} /></Field>
                {lines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove line"><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
            <Button type="button" size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, { key: k++, materialId: "", quantity: "" }])}><Plus className="h-4 w-4" /> Add material</Button>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Workers on this project ({crew.length})</CardTitle></CardHeader>
          <CardBody>
            {crew.length === 0 ? <p className="text-sm text-slate-500">No workers are assigned to this project.</p> : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {crew.map((w) => (
                  <li key={w.id}>
                    <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5", picked.has(w.id) ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
                      <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={picked.has(w.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(w.id); else n.delete(w.id); return n; })} />
                      <span className="text-sm font-medium text-slate-900">{w.name}</span> <span className="text-xs text-slate-500">{humanize(w.trade)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-4">
          <Field label="Reason"><Textarea name="reason" rows={2} placeholder="Why is it being moved?" /></Field>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="emergency" className="h-4 w-4 accent-red-600" /> This is an emergency (Management can approve and the project manager is informed)</label>
        </CardBody>
      </Card>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
      <Button type="submit" size="lg" className="h-12 w-full" loading={pending} disabled={!toId}>{pending ? "Sending…" : "Send for approval"}</Button>
    </form>
  );
}
