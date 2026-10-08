"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";
import type { Opt } from "@/lib/enums";

type Mat = { value: string; label: string; unit: string };
type Row = { key: string; materialId: string; quantity: number | "" };
let n = 0;
const mk = (): Row => ({ key: `i${Date.now()}_${n++}`, materialId: "", quantity: "" });

/** Issue material to a site, or return unused material back to a warehouse. */
export function IssueForm({ mode, projects, warehouses, materials, stock, siteOf, action, defaultProject }: {
  mode: "issue" | "return";
  projects: Opt[];
  warehouses: Opt[];
  materials: Mat[];
  /** stock[locationId][materialId] = available quantity */
  stock: Record<string, Record<string, number>>;
  /** siteOf[projectId] = site location id (if any) */
  siteOf: Record<string, string>;
  action: (fd: FormData) => Promise<ActionResult>;
  defaultProject?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [project, setProject] = React.useState(defaultProject ?? "");
  const [warehouse, setWarehouse] = React.useState(warehouses[0]?.value ?? "");
  const [rows, setRows] = React.useState<Row[]>([mk()]);

  const sourceLoc = mode === "issue" ? warehouse : siteOf[project];
  const avail = (mid: string) => (sourceLoc ? stock[sourceLoc]?.[mid] ?? 0 : 0);
  const opts = materials.filter((m) => avail(m.value) > 0 || rows.some((r) => r.materialId === m.value));
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("items", JSON.stringify(rows.filter((r) => r.materialId).map((r) => ({ materialId: r.materialId, quantity: r.quantity === "" ? 0 : r.quantity }))));
    setErrors({});
    start(async () => {
      const r = await action(fd);
      if (r.ok) {
        toast.success(r.message ?? "Recorded");
        router.push("/inventory/issues");
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Card>
        <CardHeader><CardTitle>{mode === "issue" ? "Issue to project site" : "Return from project site"}</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Project" required error={errors.projectId}>
            <Select name="projectId" value={project} onChange={(e) => setProject(e.target.value)} required><option value="">Select project…</option>{projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
          </Field>
          {mode === "issue" ? (
            <Field label="Issue from warehouse" required error={errors.fromLocationId}>
              <Select name="fromLocationId" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required>{warehouses.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</Select>
            </Field>
          ) : (
            <Field label="Return to warehouse" required error={errors.toLocationId}>
              <Select name="toLocationId" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required>{warehouses.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</Select>
            </Field>
          )}
          {mode === "issue" ? <Field label="Received by (site person)"><Input name="receivedBy" placeholder="Name" /></Field> : <Field label="Reason"><Input name="note" placeholder="e.g. Excess after completion" /></Field>}
          {mode === "issue" && <Field label="Purpose" className="sm:col-span-2 lg:col-span-3"><Textarea name="purpose" rows={2} placeholder="e.g. Kitchen carcass work" /></Field>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Materials</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          {mode === "return" && project && !siteOf[project] && <p className="text-sm text-amber-700">This project has no site stock yet – there is nothing to return.</p>}
          {rows.map((r, i) => {
            const a = r.materialId ? avail(r.materialId) : 0;
            const over = r.quantity !== "" && Number(r.quantity) > a;
            const unit = materials.find((m) => m.value === r.materialId)?.unit ?? "";
            return (
              <div key={r.key} className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-12 sm:col-span-6"><Select value={r.materialId} onChange={(e) => set(r.key, { materialId: e.target.value })} aria-label={`Material ${i + 1}`}><option value="">Select material…</option>{opts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></div>
                <div className="col-span-5 sm:col-span-3"><Input type="number" min="0" step="any" value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value === "" ? "" : Number(e.target.value) })} className={`text-right ${over ? "border-red-400" : ""}`} placeholder="Qty" aria-label={`Quantity ${i + 1}`} /></div>
                <div className="col-span-5 text-xs sm:col-span-2"><span className={over ? "font-medium text-red-600" : "text-slate-500"}>{r.materialId ? `${a} ${unit} available` : ""}</span></div>
                <button type="button" className="col-span-2 justify-self-end rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 sm:col-span-1" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))} aria-label={`Remove ${i + 1}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            );
          })}
          {(errors._ || errors.items) && <p className="text-sm font-medium text-red-600">{errors._ ?? errors.items}</p>}
          <Button type="button" size="sm" variant="secondary" onClick={() => setRows((rs) => [...rs, mk()])}><Plus className="h-4 w-4" /> Add material</Button>
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button><Button type="submit" loading={pending}>{mode === "issue" ? "Issue material" : "Record return"}</Button></div>
    </form>
  );
}
