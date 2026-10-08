import { redirect } from "next/navigation";
import { FileDown } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeTotals } from "@/lib/money";
import { formatDate, formatINR, humanize, num } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { respondToQuotation } from "../actions";
import { markViewed } from "./viewed";

export const metadata = { title: "My Quotations" };

export default async function ClientQuotations() {
  const c = await requireCtx();
  if (c.role !== "CLIENT" || !c.clientId) redirect("/");
  const qs = await db.quotation.findMany({ where: { companyId: c.companyId, clientId: c.clientId, deletedAt: null, status: { in: ["SENT", "VIEWED", "NEGOTIATION", "ACCEPTED", "EXPIRED"] } }, include: { items: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "desc" } });
  await markViewed(qs.filter((q) => q.status === "SENT").map((q) => q.id), c.companyId);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Quotations</h1>
      {qs.length === 0 ? <Card><EmptyState title="No quotations to show" /></Card> : qs.map((q) => {
        const t = computeTotals(q.items.map((i) => ({ quantity: num(i.quantity), rate: num(i.rate), taxPercent: num(i.taxPercent) })), { pct: num(q.discountPct) });
        const open = ["SENT", "VIEWED", "NEGOTIATION"].includes(q.status);
        return (
          <Card key={q.id}>
            <CardHeader><div><p className="font-semibold text-slate-900">{q.number}{q.revision > 1 ? ` · revision ${q.revision}` : ""}</p><p className="text-xs text-slate-500">{q.title ?? "Interior works"} · {formatDate(q.date)}{q.validUntil ? ` · valid until ${formatDate(q.validUntil)}` : ""}</p></div><StatusBadge status={q.status === "SENT" ? "VIEWED" : q.status} /></CardHeader>
            <CardBody className="space-y-4">
              <details className="rounded-lg border border-slate-200"><summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700">View the {q.items.length} line items</summary>
                <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                  <tbody>{q.items.map((i, n) => <tr key={i.id} className="border-t border-slate-100"><td className="px-3 py-2"><span className="text-xs text-slate-400">{humanize(i.category)}</span><br />{i.description}</td><td className="tabular px-3 py-2 text-right">{num(i.quantity)} {i.unit}</td><td className="tabular px-3 py-2 text-right">{formatINR(i.rate)}</td><td className="tabular px-3 py-2 text-right font-medium">{formatINR(t.lines[n].amount)}</td></tr>)}</tbody></table></div>
              </details>
              <dl className="tabular ml-auto w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatINR(t.subtotal)}</dd></div>
                {t.discount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd>− {formatINR(t.discount)}</dd></div>}
                <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd>{formatINR(t.tax)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold"><dt>Total</dt><dd>{formatINR(t.total)}</dd></div>
              </dl>
              {q.paymentTerms && <p className="text-sm text-slate-600"><b>Payment terms:</b> {q.paymentTerms}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/sales/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer"><Button variant="secondary" size="sm"><FileDown className="h-4 w-4" /> Download PDF</Button></a>
                {open && <ActionButton size="sm" variant="success" action={respondToQuotation.bind(null, q.id, "ACCEPT", undefined)} confirm={{ title: `Accept quotation ${q.number}?`, body: `You confirm the scope and the total of ${formatINR(t.total)}. Our team will contact you to start the project.`, confirmLabel: "Yes, accept" }}>Accept quotation</ActionButton>}
                {open && <FormDialog title="Request changes" description="Tell us what you'd like changed – scope, finishes, budget…" trigger={<Button size="sm" variant="secondary">Request changes</Button>} fields={[{ name: "note", label: "What should we change?", type: "textarea", required: true }]} action={respondToQuotation.bind(null, q.id, "CHANGES")} submitLabel="Send to our team" />}
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
