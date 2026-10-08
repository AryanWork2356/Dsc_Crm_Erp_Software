"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { LineItemsEditor, newRow, type LineRow } from "@/components/forms/line-items";
import type { ActionResult } from "@/lib/action";
import { UNIT_OPTS, type Opt } from "@/lib/enums";

export function InvoiceForm({ action, clients, projects, defaultTax, initial, cancelHref }: {
  action: (fd: FormData) => Promise<ActionResult<{ id: string }>>;
  clients: Opt[];
  projects: (Opt & { clientId: string })[];
  defaultTax: number;
  initial: { clientId?: string; projectId?: string; quotationId?: string; issueDate: string; dueDate?: string; paymentTerms?: string; notes?: string; discountPct?: number; items: Omit<LineRow, "key">[] };
  cancelHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [client, setClient] = React.useState(initial.clientId ?? "");
  const rows = React.useMemo(() => initial.items.map((i) => newRow(i)), [initial.items]);
  const clientProjects = projects.filter((p) => !client || p.clientId === client);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    start(async () => {
      const r = await action(fd);
      if (r.ok) { toast.success(r.message ?? "Saved"); router.push(`/finance/invoices/${r.data?.id}`); router.refresh(); }
      else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {initial.quotationId && <input type="hidden" name="quotationId" value={initial.quotationId} />}
      <Card>
        <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Client" required error={errors.clientId}>
            <Select name="clientId" value={client} onChange={(e) => setClient(e.target.value)} required><option value="">Select client…</option>{clients.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>
          </Field>
          <Field label="Project" error={errors.projectId}>
            <Select name="projectId" defaultValue={initial.projectId ?? ""}><option value="">— None —</option>{clientProjects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
          </Field>
          <Field label="Invoice date" required error={errors.issueDate}><Input name="issueDate" type="date" defaultValue={initial.issueDate} required /></Field>
          <Field label="Due date" error={errors.dueDate}><Input name="dueDate" type="date" defaultValue={initial.dueDate} /></Field>
          <Field label="Payment terms" className="sm:col-span-2"><Input name="paymentTerms" defaultValue={initial.paymentTerms} placeholder="e.g. Payable within 15 days of invoice" /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
        <CardBody><LineItemsEditor initial={rows} units={UNIT_OPTS} defaultTax={defaultTax} discountPct={initial.discountPct} errors={errors._ ?? errors.items} /></CardBody>
      </Card>
      <Card><CardHeader><CardTitle>Notes</CardTitle></CardHeader><CardBody><Textarea name="notes" rows={3} defaultValue={initial.notes} placeholder="Shown on the invoice" /></CardBody></Card>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => router.push(cancelHref)}>Cancel</Button><Button type="submit" loading={pending}>Save invoice</Button></div>
    </form>
  );
}
