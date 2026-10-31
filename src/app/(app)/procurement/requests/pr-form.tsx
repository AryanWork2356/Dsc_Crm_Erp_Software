"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { VoiceNote } from "@/components/forms/voice-note";
import { SpeakButton } from "@/components/forms/speak-button";
import type { ActionResult } from "@/lib/action";
import { daysNotice } from "@/lib/material-notice";
import { PRIORITY_OPTS, UNIT_OPTS, type Opt } from "@/lib/enums";

type Row = { key: string; description: string; unit: string; quantity: number | ""; materialId?: string | null; boqItemId?: string | null; ownUnit?: boolean };
const OTHER_UNIT = "__other";
let n = 0;
const mk = (p: Partial<Row> = {}): Row => ({ key: `p${Date.now()}_${n++}`, description: "", unit: "nos", quantity: 1, ...p });

export function PrForm({
  action, projects, catalog, initial, cancelHref, noticeDays = 2,
}: {
  action: (fd: FormData) => Promise<ActionResult<{ id: string }>>;
  projects: Opt[];
  catalog: { id: string; name: string; unit: string }[];
  initial: { projectId?: string; requiredDate?: string; reason?: string; priority?: string; items: Omit<Row, "key">[] };
  cancelHref: string;
  noticeDays?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [rows, setRows] = React.useState<Row[]>(initial.items.length ? initial.items.map((i) => mk(i)) : [mk()]);
  const listId = React.useId();
  const [voices, setVoices] = React.useState<File[]>([]);
  const [req, setReq] = React.useState(initial.requiredDate ?? "");
  const left = req ? daysNotice(req) : null;
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function onDesc(r: Row, value: string) {
    const hit = catalog.find((c) => c.name.toLowerCase() === value.toLowerCase());
    set(r.key, hit ? { description: value, materialId: hit.id, unit: hit.unit } : { description: value, materialId: null });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sender = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (sender?.name === "submitNow") fd.set("submitNow", "1");
    for (const v of voices) fd.append("voice", v);
    fd.set("items", JSON.stringify(rows.filter((r) => r.description.trim()).map(({ key: _k, ...r }) => ({ ...r, quantity: r.quantity === "" ? 0 : r.quantity }))));
    setErrors({});
    start(async () => {
      const r = await action(fd);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        router.push(`/procurement/requests/${r.data?.id}`);
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
        <CardHeader><CardTitle>Request details</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Project"><Select name="projectId" defaultValue={initial.projectId ?? ""}><option value="">— Stock / general —</option>{projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
          <Field label="Required by" error={errors.requiredDate} hint={left !== null && left < noticeDays ? undefined : `Raise requests at least ${noticeDays} days ahead.`}>
            <Input name="requiredDate" type="date" defaultValue={initial.requiredDate} onChange={(e) => setReq(e.target.value)} />
            {left !== null && left < noticeDays && <span className="mt-1 block rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Short notice: needed in {Math.max(0, left)} day(s). Company rule is {noticeDays}. You can still send it, but write the reason below.</span>}
          </Field>
          <Field label="Priority"><Select name="priority" defaultValue={initial.priority ?? "MEDIUM"}>{PRIORITY_OPTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
          <Field label="Reason" className="sm:col-span-2 lg:col-span-4"><Textarea name="reason" rows={2} defaultValue={initial.reason} placeholder="Why is this needed?" /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Items needed</CardTitle></CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-slate-500">Type any material in your own words, pick one from the list, or press the mic and say it.</p>
          <datalist id={listId}>{catalog.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.key} className="grid grid-cols-12 items-center gap-2">
                <div className="relative col-span-12 sm:col-span-6"><Input value={r.description} list={listId} onChange={(e) => onDesc(r, e.target.value)} placeholder="Type the material, e.g. 18mm plywood" aria-label={`Item ${i + 1}`} className="pr-20" /><SpeakButton className="bottom-1.5" /></div>
                <div className="col-span-5 space-y-1 sm:col-span-2">
                  <Select value={r.ownUnit || !UNIT_OPTS.some((u) => u.value === r.unit) ? OTHER_UNIT : r.unit} onChange={(e) => set(r.key, e.target.value === OTHER_UNIT ? { unit: "", ownUnit: true } : { unit: e.target.value, ownUnit: false })} aria-label={`Unit ${i + 1}`}>
                    {UNIT_OPTS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    <option value={OTHER_UNIT}>Other…</option>
                  </Select>
                  {(r.ownUnit || !UNIT_OPTS.some((u) => u.value === r.unit)) && <Input value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} placeholder="Type the unit" aria-label={`Own unit ${i + 1}`} autoFocus />}
                </div>
                <div className="col-span-5 sm:col-span-3"><Input type="number" min="0" step="any" value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value === "" ? "" : Number(e.target.value) })} className="text-right" aria-label={`Quantity ${i + 1}`} /></div>
                <button type="button" className="col-span-2 justify-self-end rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 sm:col-span-1" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))} aria-label={`Remove item ${i + 1}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          {(errors._ || errors.items) && <p className="mt-2 text-sm font-medium text-red-600">{errors._ ?? errors.items}</p>}
          <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => setRows((rs) => [...rs, mk()])}><Plus className="h-4 w-4" /> Add item</Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Voice notes</CardTitle></CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-slate-500">Easier to say it? Record what you need; procurement can listen to it with the request.</p>
          <VoiceNote value={voices} onChange={setVoices} />
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)}>Cancel</Button>
        <Button type="submit" variant="secondary" disabled={pending}>Save as draft</Button>
        <Button type="submit" name="submitNow" value="1" loading={pending}>Send for approval</Button>
      </div>
    </form>
  );
}
