"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";
import type { Opt } from "@/lib/enums";
import { compressImage } from "@/lib/image-compress";
import { photoProblem } from "@/lib/photo-quality";
import { aiIsOn } from "@/lib/ai-flag";
import { readChallan } from "../ai-actions";

type Item = { id: string; description: string; unit: string; ordered: number; received: number; stockable: boolean };

export function ReceiptForm({ poId, poNumber, items, locations, defaultLocation, today, action, ai = false }: {
  poId: string; poNumber: string; items: Item[]; locations: Opt[]; defaultLocation?: string; today: string; ai?: boolean;
  action: (fd: FormData) => Promise<ActionResult<{ id: string }>>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [rows, setRows] = React.useState(() => Object.fromEntries(items.map((i) => [i.id, { rec: Math.max(0, i.ordered - i.received), dam: 0, rej: 0 }])));
  const set = (id: string, k: "rec" | "dam" | "rej", v: number) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: Number.isFinite(v) ? v : 0 } }));
  const formRef = React.useRef<HTMLFormElement>(null);
  const [aiOn, setAiOn] = React.useState(false);
  React.useEffect(() => { setAiOn(ai && aiIsOn()); }, [ai]);
  const [reading, setReading] = React.useState(false);
  const [warn, setWarn] = React.useState<string | null>(null);
  const [filled, setFilled] = React.useState<string | null>(null);

  const put = (name: string, value: string) => {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null;
    if (!el || !value) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  /** A new challan photo is checked on the phone for blur and darkness (a warning only). */
  async function photoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFilled(null);
    setWarn(f && aiOn ? await photoProblem(f) : null);
  }

  async function readIt() {
    const photo = (formRef.current?.elements.namedItem("challanPhoto") as HTMLInputElement | null)?.files?.[0];
    if (!photo) return void toast.error("Take or choose the photo of the challan first.");
    setReading(true); setFilled(null);
    const fd = new FormData();
    fd.set("challanPhoto", await compressImage(photo));
    const r = await readChallan(poId, fd);
    setReading(false);
    if (!r.ok) return void toast.error(r.error);
    const d = r.data as { challanNo: string | null; date: string | null; vehicleNo: string | null; rows: { poItemId: string; quantity: number }[]; unmatched: string[]; note: string | null };
    if (d.challanNo) put("challanNo", d.challanNo);
    if (d.vehicleNo) put("vehicleNo", d.vehicleNo);
    if (d.date) put("deliveryDate", d.date);
    setRows((cur) => {
      const next = { ...cur };
      for (const x of d.rows) if (next[x.poItemId]) next[x.poItemId] = { ...next[x.poItemId], rec: x.quantity };
      return next;
    });
    setFilled([`${d.rows.length} item(s) filled from the challan. Check the quantities, and enter anything damaged or rejected.`, d.unmatched.length ? `Not matched to this order: ${d.unmatched.join("; ")}.` : null, d.note].filter(Boolean).join(" "));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("items", JSON.stringify(items.map((i) => ({ poItemId: i.id, receivedQty: rows[i.id].rec, damagedQty: rows[i.id].dam, rejectedQty: rows[i.id].rej }))));
    setErrors({});
    start(async () => {
      const photo = fd.get("challanPhoto");
      if (photo instanceof File && photo.size > 0) fd.set("challanPhoto", await compressImage(photo));
      const r = await action(fd);
      if (r.ok) {
        toast.success(r.message ?? "Recorded");
        router.push(`/procurement/orders/${poId}`);
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-5" noValidate>
      <input type="hidden" name="poId" value={poId} />
      <Card>
        <CardHeader><CardTitle>Delivery details – {poNumber}</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Delivered to" required error={errors.locationId}><Select name="locationId" defaultValue={defaultLocation ?? ""} required><option value="">Select location…</option>{locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</Select></Field>
          <Field label="Delivery date" required error={errors.deliveryDate}><Input name="deliveryDate" type="date" defaultValue={today} required /></Field>
          <Field label="Challan / invoice no."><Input name="challanNo" /></Field>
          <Field label="Photo of the challan" hint={aiOn ? "Take a photo of the challan, then press Read the challan: the boxes fill in by themselves." : "Take a photo of the delivery challan – it is saved with this delivery."}>
            <Input name="challanPhoto" type="file" accept={aiOn ? "image/*,application/pdf" : "image/*"} capture={aiOn ? undefined : "environment"} onChange={(e) => void photoChosen(e)} className="h-auto py-1.5" />
            {aiOn && <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => void readIt()} loading={reading}>Read the challan</Button>}
            {warn && <span className="mt-1 block rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{warn}</span>}
          </Field>
          <Field label="Vehicle no."><Input name="vehicleNo" /></Field>
        </CardBody>
      </Card>
      {filled && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 ring-1 ring-emerald-200">{filled}</p>}
      <Card>
        <CardHeader><CardTitle>What arrived</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Item</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Earlier</th><th className="w-28 px-2 py-2 text-right">Received now</th><th className="w-24 px-2 py-2 text-right">Damaged</th><th className="w-24 px-2 py-2 text-right">Rejected</th><th className="px-3 py-2 text-right">Accepted</th></tr></thead>
            <tbody>
              {items.map((i) => {
                const r = rows[i.id];
                const acc = r.rec - r.dam - r.rej;
                const pendingQty = i.ordered - i.received;
                const bad = acc < 0 || acc > pendingQty + 1e-9;
                return (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5"><p className="font-medium text-slate-900">{i.description}</p>{!i.stockable && <p className="text-xs text-amber-600">Not in material catalogue – recorded on the receipt but not added to stock</p>}</td>
                    <td className="tabular px-3 py-2.5 text-right">{i.ordered} {i.unit}</td>
                    <td className="tabular px-3 py-2.5 text-right">{i.received}</td>
                    {(["rec", "dam", "rej"] as const).map((k) => (
                      <td key={k} className="px-1.5 py-1.5"><Input type="number" min="0" step="any" value={r[k]} onChange={(e) => set(i.id, k, Number(e.target.value))} className="h-9 text-right" aria-label={`${k === "rec" ? "Received" : k === "dam" ? "Damaged" : "Rejected"} – ${i.description}`} /></td>
                    ))}
                    <td className={`tabular px-3 py-2.5 text-right font-semibold ${bad ? "text-red-600" : "text-slate-900"}`}>{acc}{bad && <span className="block text-[11px] font-normal">max {pendingQty}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <CardBody className="border-t border-slate-100"><Field label="Remarks / condition notes"><Textarea name="remarks" rows={2} /></Field></CardBody>
      </Card>
      {errors._ && <p className="text-sm font-medium text-red-600">{errors._}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button><Button type="submit" loading={pending}>Record receipt</Button></div>
    </form>
  );
}
