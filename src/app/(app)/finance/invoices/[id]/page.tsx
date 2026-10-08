import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { PAYMENT_METHOD_OPTS } from "@/lib/enums";
import { formatDate, formatINR, humanize, num, startOfDay, toDateInput } from "@/lib/utils";
import { PageHeader, DetailGrid, Alert, EmptyState, Progress } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { cancelInvoice, deletePayment, recordPayment, submitInvoice } from "../../actions";

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("invoices:view");
  const inv = await db.invoice.findFirst({
    where: { id, companyId: c.companyId, deletedAt: null },
    include: { client: true, project: { select: { id: true, code: true, name: true } }, quotation: { select: { id: true, number: true } }, items: true, payments: { orderBy: { date: "desc" } } },
  });
  if (!inv) notFound();
  const pending = inv.status === "PENDING_APPROVAL" ? await db.approval.findFirst({ where: { companyId: c.companyId, entityType: "Invoice", entityId: id, status: "PENDING" } }) : null;
  const balance = num(inv.total) - num(inv.paid);
  const issued = !["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(inv.status);
  const late = issued && balance > 0.005 && inv.dueDate && inv.dueDate < startOfDay();

  return (
    <>
      <PageHeader
        back={{ href: "/finance/invoices", label: "Invoices" }} title={inv.number}
        subtitle={<><Link href={`/crm/clients/${inv.clientId}`} className="text-brand-700 hover:underline">{inv.client.name}</Link>{inv.project && <> · <Link href={`/projects/${inv.project.id}`} className="text-brand-700 hover:underline">{inv.project.code}</Link></>}</>}
        actions={<>
          <StatusBadge status={inv.status} />
          <a href={`/finance/invoices/${id}/pdf`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><FileDown className="h-4 w-4" /> PDF</Button></a>
          {c.can("invoices:edit") && inv.status === "DRAFT" && <Link href={`/finance/invoices/${id}/edit`}><Button size="sm" variant="secondary">Edit</Button></Link>}
          {c.can("invoices:edit") && inv.status === "DRAFT" && <ActionButton size="sm" action={submitInvoice.bind(null, id)}>Submit for approval</ActionButton>}
          {c.can("payments:create") && issued && balance > 0.005 && (
            <FormDialog title={`Record payment – ${inv.number}`} description={`Balance due: ${formatINR(balance, true)}`} trigger={<Button size="sm">Record payment</Button>}
              fields={[{ name: "invoiceId", label: "Invoice", type: "hidden", defaultValue: id }, { name: "amount", label: "Amount received (₹)", type: "number", required: true, defaultValue: Math.round(balance * 100) / 100 }, { name: "date", label: "Date received", type: "date", required: true, defaultValue: toDateInput(new Date()) }, { name: "method", label: "Method", type: "select", options: PAYMENT_METHOD_OPTS, defaultValue: "BANK_TRANSFER" }, { name: "reference", label: "Reference / UTR / cheque no." }, { name: "notes", label: "Notes", type: "textarea" }]}
              action={recordPayment} submitLabel="Record" />
          )}
          {c.can("invoices:delete") && inv.status !== "CANCELLED" && num(inv.paid) === 0 && (
            <FormDialog title={`Cancel ${inv.number}?`} trigger={<Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50">Cancel invoice</Button>} fields={[{ name: "reason", label: "Reason", type: "textarea" }]} action={cancelInvoice.bind(null, id)} submitLabel="Cancel invoice" />
          )}
        </>}
      />
      {pending && <div className="mb-4"><Alert tone="warn">Waiting for approval from <b>{humanize(pending.requiredRole)}</b> before it is issued to the client. <Link href="/approvals" className="font-medium underline">Open approvals</Link></Alert></div>}
      {late && <div className="mb-4"><Alert tone="bad">Overdue since {formatDate(inv.dueDate)} – {formatINR(balance)} still unpaid.</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">#</th><th className="px-4 py-2 text-left">Description</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Rate</th><th className="px-4 py-2 text-right">GST</th><th className="px-4 py-2 text-right">Amount</th></tr></thead>
                <tbody>{inv.items.map((i, n) => <tr key={i.id} className="border-t border-slate-100"><td className="px-4 py-2.5 text-slate-400">{n + 1}</td><td className="px-4 py-2.5 text-slate-900">{i.description}</td><td className="tabular px-4 py-2.5 text-right">{num(i.quantity)} {i.unit}</td><td className="tabular px-4 py-2.5 text-right">{formatINR(i.rate, true)}</td><td className="tabular px-4 py-2.5 text-right">{num(i.taxPercent)}%</td><td className="tabular px-4 py-2.5 text-right font-medium">{formatINR(i.amount, true)}</td></tr>)}</tbody>
              </table>
            </div>
            <CardBody className="flex justify-end">
              <dl className="tabular w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatINR(inv.subtotal, true)}</dd></div>
                {num(inv.discount) > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd>− {formatINR(inv.discount, true)}</dd></div>}
                <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd>{formatINR(inv.taxAmount, true)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900"><dt>Total</dt><dd>{formatINR(inv.total, true)}</dd></div>
                <div className="flex justify-between text-emerald-700"><dt>Paid</dt><dd>{formatINR(inv.paid, true)}</dd></div>
                <div className="flex justify-between font-semibold text-amber-700"><dt>Balance</dt><dd>{formatINR(Math.max(0, balance), true)}</dd></div>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Payments received</CardTitle></CardHeader>
            {inv.payments.length === 0 ? <EmptyState title="No payments yet" /> : (
              <ul className="divide-y divide-slate-100">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="font-medium">{formatDate(p.date)}</span><span className="text-slate-500">{humanize(p.method)}{p.reference ? ` · ${p.reference}` : ""}</span>
                    <span className="tabular ml-auto font-semibold">{formatINR(p.amount, true)}</span>
                    {c.can("payments:delete") && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deletePayment.bind(null, p.id)} confirm={{ title: "Reverse this payment?", body: "The invoice balance will go back up.", confirmLabel: "Reverse" }}>Reverse</ActionButton>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>Collection</CardTitle></CardHeader><CardBody><Progress value={num(inv.total) ? (num(inv.paid) / num(inv.total)) * 100 : 0} /><p className="mt-2 text-sm text-slate-600">{formatINR(inv.paid)} of {formatINR(inv.total)} received</p></CardBody></Card>
          <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardBody>
            <DetailGrid items={[{ label: "Invoice date", value: formatDate(inv.issueDate) }, { label: "Due date", value: formatDate(inv.dueDate) }, { label: "Payment terms", value: inv.paymentTerms }, { label: "Quotation", value: inv.quotation ? <Link className="text-brand-700 hover:underline" href={`/sales/quotations/${inv.quotation.id}`}>{inv.quotation.number}</Link> : null }, { label: "Client GSTIN", value: inv.client.gstin }]} />
            {inv.notes && <p className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-4 text-sm text-slate-700">{inv.notes}</p>}
          </CardBody></Card>
        </div>
      </div>
    </>
  );
}
