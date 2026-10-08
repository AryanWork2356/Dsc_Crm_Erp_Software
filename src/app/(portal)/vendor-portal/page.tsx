import Link from "next/link";
import { redirect } from "next/navigation";
import { FileDown } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatINR, num, startOfDay, toDateInput } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, StatCard, Progress } from "@/components/ui/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { acknowledgeOrder, messageProcurement } from "./actions";

export const metadata = { title: "My Orders" };

export default async function VendorHome() {
  const c = await requireCtx();
  if (c.role !== "VENDOR" || !c.vendorId) redirect("/");
  const pos = await db.purchaseOrder.findMany({
    where: { companyId: c.companyId, vendorId: c.vendorId, status: { in: ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] } },
    include: { items: true, project: { select: { name: true, siteAddress: true } } }, orderBy: { orderDate: "desc" },
  });
  const today = startOfDay();
  const open = pos.filter((p) => ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"].includes(p.status));
  const late = open.filter((p) => p.deliveryDate && p.deliveryDate < today);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Purchase orders</h1>
        <FormDialog title="Message our procurement team" trigger={<Button variant="secondary">Send a message</Button>} fields={[{ name: "poId", label: "About order (optional)", type: "select", options: pos.map((p) => ({ value: p.id, label: p.number })) }, { name: "message", label: "Message", type: "textarea", required: true }]} action={messageProcurement} submitLabel="Send" /></div>
      <div className="grid grid-cols-3 gap-3"><StatCard label="Open orders" value={open.length} /><StatCard label="Past delivery date" value={late.length} tone={late.length ? "bad" : "good"} /><StatCard label="Open order value" value={formatINR(open.reduce((s, p) => s + num(p.total), 0))} /></div>
      {pos.length === 0 ? <Card><EmptyState title="No orders yet" /></Card> : pos.map((p) => {
        const ord = p.items.reduce((s, i) => s + num(i.quantity), 0);
        const got = p.items.reduce((s, i) => s + num(i.receivedQty), 0);
        const isLate = p.deliveryDate && p.deliveryDate < today && open.includes(p);
        return (
          <Card key={p.id}>
            <CardHeader><div><p className="font-semibold text-slate-900">{p.number}</p><p className="text-xs text-slate-500">Ordered {formatDate(p.orderDate)} · deliver to {p.project?.name ?? "our warehouse"}{p.project?.siteAddress ? `, ${p.project.siteAddress}` : ""}</p></div><div className="flex items-center gap-2">{isLate && <Badge tone="red">Past due</Badge>}<StatusBadge status={p.status} /></div></CardHeader>
            <CardBody className="space-y-3">
              <ul className="space-y-1 text-sm">{p.items.map((i) => <li key={i.id} className="flex justify-between gap-3"><span className="text-slate-800">{i.description}</span><span className="tabular shrink-0 text-slate-600">{num(i.receivedQty)} / {num(i.quantity)} {i.unit}</span></li>)}</ul>
              <div className="flex items-center gap-3"><Progress value={ord ? (got / ord) * 100 : 0} className="flex-1" /><span className="text-xs text-slate-500">{ord ? Math.round((got / ord) * 100) : 0}% delivered</span></div>
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-600">Delivery by <b className={isLate ? "text-red-600" : "text-slate-900"}>{formatDate(p.deliveryDate)}</b> · {formatINR(p.total)} incl. GST{p.paymentTerms ? ` · ${p.paymentTerms}` : ""}</span>
                <span className="ml-auto flex gap-2">
                  <a href={`/procurement/orders/${p.id}/pdf`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><FileDown className="h-4 w-4" /> PO PDF</Button></a>
                  {open.includes(p) && <FormDialog title={`Update ${p.number}`} description="Confirm the order and tell us when it will reach site." trigger={<Button size="sm">Confirm / update delivery</Button>} fields={[{ name: "expectedDate", label: "Expected delivery date", type: "date", defaultValue: toDateInput(p.deliveryDate) }, { name: "note", label: "Note", type: "textarea", placeholder: "e.g. 80% ready, balance by Friday" }]} action={acknowledgeOrder.bind(null, p.id)} submitLabel="Send update" />}
                </span>
              </div>
            </CardBody>
          </Card>
        );
      })}
      <p className="text-xs text-slate-400"><Link href="/vendor-portal/payments" className="text-brand-700 hover:underline">See your payment status →</Link></p>
    </div>
  );
}
