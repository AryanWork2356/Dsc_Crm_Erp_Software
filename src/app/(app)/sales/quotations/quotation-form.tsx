"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { USE_LEADS } from "@/lib/features";
import { LineItemsEditor, newRow, type LineRow } from "@/components/forms/line-items";
import type { ActionResult } from "@/lib/action";
import { BOQ_CATEGORY_OPTS, UNIT_OPTS, type Opt } from "@/lib/enums";
import { PAYMENT_PRESETS } from "@/lib/payment-terms";
import { STATE_OPTIONS } from "@/lib/gst";

type Props = {
  action: (fd: FormData) => Promise<ActionResult<{ id: string }>>;
  clients: Opt[];
  leads: Opt[];
  templates: { id: string; name: string; body: string }[];
  defaultTax: number;
  initial: {
    clientId?: string; leadId?: string; title?: string; date: string; validUntil?: string;
    terms?: string; paymentTerms?: string; placeOfSupply?: string; clientPoNo?: string; clientPoDate?: string; vendorCode?: string; notes?: string; discountPct?: number; items: Omit<LineRow, "key">[];
  };
  cancelHref: string;
};

export function QuotationForm({ action, clients, leads, templates, defaultTax, initial, cancelHref }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [terms, setTerms] = React.useState(initial.terms ?? "");
  const [payTerms, setPayTerms] = React.useState(initial.paymentTerms ?? "");
  const rows = React.useMemo(() => initial.items.map((i) => newRow(i)), [initial.items]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    start(async () => {
      const r = await action(fd);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        router.push(`/sales/quotations/${r.data?.id}`);
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
        <CardHeader><CardTitle>Quotation details</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Client" required error={errors.clientId}>
            <Select name="clientId" defaultValue={initial.clientId ?? ""} required>
              <option value="">Select client…</option>
              {clients.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          {USE_LEADS && (
            <Field label="Linked lead" hint="Optional – keeps the lead pipeline in sync">
              <Select name="leadId" defaultValue={initial.leadId ?? ""}>
                <option value="">— None —</option>
                {leads.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Title / scope" error={errors.title}>
            <Input name="title" defaultValue={initial.title} placeholder="e.g. 3BHK full interior – Lodha Splendora" />
          </Field>
          <Field label="Date" required error={errors.date}>
            <Input name="date" type="date" defaultValue={initial.date} required />
          </Field>
          <Field label="Valid until" error={errors.validUntil}>
            <Input name="validUntil" type="date" defaultValue={initial.validUntil} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
        <CardBody>
          <LineItemsEditor initial={rows} units={UNIT_OPTS} categories={BOQ_CATEGORY_OPTS} defaultTax={defaultTax} discountPct={initial.discountPct} errors={errors._ ?? errors.items} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Terms</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Terms &amp; conditions" className="sm:col-span-2">
            <div className="space-y-2">
              {templates.length > 0 && (
                <Select aria-label="Load a template" defaultValue="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setTerms(t.body); }}>
                  <option value="">Load from template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              )}
              <Textarea name="terms" rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} />
            </div>
          </Field>
          <Field label="Client PO number" hint="If the client gave you a purchase order"><Input name="clientPoNo" defaultValue={initial.clientPoNo ?? ""} /></Field>
          <Field label="Client PO date"><Input name="clientPoDate" type="date" defaultValue={initial.clientPoDate ?? ""} /></Field>
          <Field label="Vendor code" hint="Our code in the client's books"><Input name="vendorCode" defaultValue={initial.vendorCode ?? ""} /></Field>
          <Field label="Place of supply (GST)" hint="Blank = state in the client's GSTIN"><Select name="placeOfSupply" defaultValue={initial.placeOfSupply ?? ""}><option value="">From the client&apos;s GSTIN</option>{STATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="Payment terms" hint="Pick a schedule, then edit if needed.">
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {PAYMENT_PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => setPayTerms(p.text)} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50">{p.label}</button>
              ))}
            </div>
            <Textarea name="paymentTerms" value={payTerms} onChange={(e) => setPayTerms(e.target.value)} rows={3} placeholder="e.g. 40% advance, 30% on carcass, 20% on finishing, 10% on handover" />
          </Field>
          <Field label="Notes"><Textarea name="notes" defaultValue={initial.notes} /></Field>
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)}>Cancel</Button>
        <Button type="submit" loading={pending}>Save quotation</Button>
      </div>
    </form>
  );
}
