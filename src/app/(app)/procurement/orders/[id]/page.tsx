import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileDown } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { formatDate, formatINR, humanize, num, startOfDay } from "@/lib/utils";
import { PageHeader, DetailGrid, Alert, Progress } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { cancelPurchaseOrder, closePurchaseOrder, sendPurchaseOrder, submitPurchaseOrder } from "../../actions";

export default async function PoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("purchase_orders:view");
  const po = await db.purchaseOrder.findFirst({
    where: { id, companyId: c.companyId },
    include: { vendor: true, project: { select: { id: true, code: true, name: true } }, items: true, receipts: { orderBy: { deliveryDate: "desc" } } },
  });
  if (!po) notFound();
  if (!["OWNER", "MANAGEMENT", "ADMIN", "PROCUREMENT", "ACCOUNTS", "STORE"].includes(c.role)) {
    const ok = po.projectId ? await db.project.findFirst({ where: { id: po.projectId, ...projectScope(c) }, select: { id: true } }) : null;
    if (!ok) redirect("/forbidden");
  }
  const money = c.can("margins:view") || c.can("vendor_bills:view") || c.role === "PROCUREMENT";
  const pending = po.status === "PENDING_APPROVAL" ? await db.approval.findFirst({ where: { companyId: c.companyId, entityType: "PurchaseOrder", entityId: id, status: "PENDING" } }) : null;
  const edit = c.can("purchase_orders:edit");
  const ordered = po.items.reduce((s, i) => s + num(i.quantity), 0);
  const got = po.items.reduce((s, i) => s + num(i.receivedQty), 0);
  const late = po.deliveryDate && po.deliveryDate < startOfDay() && ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"].includes(po.status);

  return (
    <>
      <PageHeader
        back={{ href: "/procurement/orders", label: "Purchase orders" }}
        title={po.number}
        subtitle={<><Link href={`/procurement/vendors/${po.vendorId}`} className="text-brand-700 hover:underline">{po.vendor.name}</Link>{po.project && <> · <Link href={`/projects/${po.project.id}`} className="text-brand-700 hover:underline">{po.project.code}</Link></>}</>}
        actions={
          <>
            <StatusBadge status={po.status} />
            <a href={`/procurement/orders/${id}/pdf`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><FileDown className="h-4 w-4" /> PDF</Button></a>
            {edit && po.status === "DRAFT" && <Link href={`/procurement/orders/${id}/edit`}><Button size="sm" variant="secondary">Edit</Button></Link>}
            {edit && po.status === "DRAFT" && <ActionButton size="sm" action={submitPurchaseOrder.bind(null, id)}>Submit for approval</ActionButton>}
            {edit && po.status === "APPROVED" && <ActionButton size="sm" action={sendPurchaseOrder.bind(null, id)}>Mark sent to vendor</ActionButton>}
            {c.can("inventory:create") && ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"].includes(po.status) && <Link href={`/inventory/receipts/new?poId=${id}`}><Button size="sm">Receive material</Button></Link>}
            {edit && ["RECEIVED", "PARTIALLY_RECEIVED"].includes(po.status) && <ActionButton size="sm" variant="secondary" action={closePurchaseOrder.bind(null, id)} confirm={{ title: "Close this order?", body: po.status === "PARTIALLY_RECEIVED" ? "Some items are still pending. Closing marks the order as complete anyway (short-close)." : undefined, confirmLabel: "Close order" }}>Close order</ActionButton>}
            {edit && ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_VENDOR"].includes(po.status) && (
              <FormDialog title={`Cancel ${po.number}?`} trigger={<Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50">Cancel order</Button>} fields={[{ name: "reason", label: "Reason", type: "textarea" }]} action={cancelPurchaseOrder.bind(null, id)} submitLabel="Cancel order" />
            )}
          </>
        }
      />
      {pending && <div className="mb-4"><Alert tone="warn">Waiting for approval from <b>{humanize(pending.requiredRole)}</b>. <Link href="/approvals" className="font-medium underline">Open approvals</Link></Alert></div>}
      {late && <div className="mb-4"><Alert tone="bad">Delivery was due on {formatDate(po.deliveryDate)} and is still pending. Follow up with the vendor.</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Items</CardTitle><div className="flex items-center gap-2 text-xs text-slate-500"><Progress value={ordered ? (got / ordered) * 100 : 0} className="w-24" />{got} / {ordered} received</div></CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">#</th><th className="px-4 py-2 text-left">Item</th><th className="px-4 py-2 text-right">Ordered</th><th className="px-4 py-2 text-right">Received</th><th className="px-4 py-2 text-right">Pending</th>{money && <><th className="px-4 py-2 text-right">Rate</th><th className="px-4 py-2 text-right">Amount</th></>}</tr></thead>
                <tbody>
                  {po.items.map((i, n) => (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 text-slate-400">{n + 1}</td><td className="px-4 py-2.5 text-slate-900">{i.description}</td>
                      <td className="tabular px-4 py-2.5 text-right">{num(i.quantity)} {i.unit}</td><td className="tabular px-4 py-2.5 text-right">{num(i.receivedQty)}</td>
                      <td className="tabular px-4 py-2.5 text-right">{Math.max(0, num(i.quantity) - num(i.receivedQty))}</td>
                      {money && <><td className="tabular px-4 py-2.5 text-right">{formatINR(i.rate, true)}</td><td className="tabular px-4 py-2.5 text-right font-medium">{formatINR(i.amount, true)}</td></>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {money && (
              <CardBody className="flex justify-end">
                <dl className="tabular w-full max-w-xs space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatINR(po.subtotal, true)}</dd></div>
                  {num(po.discountAmount) > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd>− {formatINR(po.discountAmount, true)}</dd></div>}
                  <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd>{formatINR(po.taxAmount, true)}</dd></div>
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900"><dt>Total</dt><dd>{formatINR(po.total, true)}</dd></div>
                </dl>
              </CardBody>
            )}
          </Card>
          {po.notes && <Card><CardHeader><CardTitle>Terms &amp; notes</CardTitle></CardHeader><CardBody><p className="whitespace-pre-wrap text-sm text-slate-700">{po.notes}</p></CardBody></Card>}
        </div>
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardBody>
            <DetailGrid items={[{ label: "Order date", value: formatDate(po.orderDate) }, { label: "Delivery due", value: formatDate(po.deliveryDate) }, { label: "Payment terms", value: po.paymentTerms }, { label: "Vendor contact", value: [po.vendor.contactPerson, po.vendor.phone].filter(Boolean).join(" · ") }]} />
          </CardBody></Card>
          <Card><CardHeader><CardTitle>Deliveries</CardTitle></CardHeader><CardBody className="space-y-2 py-3">
            {po.receipts.length === 0 && <p className="text-sm text-slate-500">Nothing received yet.</p>}
            {po.receipts.map((r) => <div key={r.id} className="flex justify-between text-sm"><span className="font-medium">{r.number}</span><span className="text-slate-500">{formatDate(r.deliveryDate)}{r.challanNo ? ` · ${r.challanNo}` : ""}</span></div>)}
          </CardBody></Card>
        </div>
      </div>
    </>
  );
}
