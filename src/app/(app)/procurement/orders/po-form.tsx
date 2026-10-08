"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { LineItemsEditor, newRow, type CatalogItem, type LineRow } from "@/components/forms/line-items";
import type { ActionResult } from "@/lib/action";
import { UNIT_OPTS, type Opt } from "@/lib/enums";

export function PoForm({
  action, vendors, projects, catalog, defaultTax, initial, cancelHref, templates,
}: {
  action: (fd: FormData) => Promise<ActionResult<{ id: string }>>;
  vendors: Opt[];
  projects: Opt[];
  catalog: CatalogItem[];
  defaultTax: number;
  templates: { id: string; name: string; body: string }[];
  initial: { vendorId?: string; projectId?: string; requestId?: string; deliveryDate?: string; paymentTerms?: string; notes?: string; discountPct?: number; items: Omit<LineRow, "key">[] };
  cancelHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const rows = React.useMemo(() => initial.items.map((i) => newRow(i)), [initial.items]);
  const [notes, setNotes] = React.useState(initial.notes ?? "");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    start(async () => {
      const r = await action(fd);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        router.push(`/procurement/orders/${r.data?.id}`);
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {initial.requestId && <input type="hidden" name="requestId" value={initial.requestId} />}
      <Card>
        <CardHeader><CardTitle>Order details</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Vendor" required error={errors.vendorId}>
            <Select name="vendorId" defaultValue={initial.vendorId ?? ""} required><option value="">Select vendor…</option>{vendors.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</Select>
          </Field>
          <Field label="Project" hint="Costs are charged to this project"><Select name="projectId" defaultValue={initial.projectId ?? ""}><option value="">— Stock / general —</option>{projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
          <Field label="Delivery date" error={errors.deliveryDate}><Input name="deliveryDate" type="date" defaultValue={initial.deliveryDate} /></Field>
          <Field label="Payment terms"><Input name="paymentTerms" defaultValue={initial.paymentTerms} placeholder="e.g. 50% advance, balance on delivery" /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <CardBody><LineItemsEditor initial={rows} units={UNIT_OPTS} catalog={catalog} defaultTax={defaultTax} discountPct={initial.discountPct} errors={errors._ ?? errors.items} /></CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Terms &amp; notes</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          {templates.length > 0 && <Select aria-label="Load terms template" defaultValue="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setNotes(t.body); }}><option value="">Load terms from template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
          <Textarea name="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)}>Cancel</Button>
        <Button type="submit" loading={pending}>Save purchase order</Button>
      </div>
    </form>
  );
}
