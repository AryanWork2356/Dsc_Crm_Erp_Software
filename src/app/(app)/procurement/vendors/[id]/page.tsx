import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatINR, num, startOfDay } from "@/lib/utils";
import { PageHeader, DetailGrid, StatCard, EmptyState } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { deleteVendor, updateVendor } from "../../actions";
import { vendorFields } from "../vendor-fields";
import { DocumentsPanel } from "@/components/documents/documents-panel";

export default async function VendorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("vendors:view");
  const v = await db.vendor.findFirst({
    where: { id, companyId: c.companyId, deletedAt: null },
    include: {
      purchaseOrders: { orderBy: { createdAt: "desc" }, take: 25, include: { project: { select: { code: true } }, receipts: { select: { deliveryDate: true } } } },
      bills: { where: { status: { not: "CANCELLED" } }, orderBy: { billDate: "desc" }, take: 25 },
      materials: { where: { deletedAt: null }, select: { id: true, name: true } },
    },
  });
  if (!v) notFound();
  const money = c.can("vendor_bills:view");
  const live = v.purchaseOrders.filter((p) => !["DRAFT", "CANCELLED"].includes(p.status));
  const purchased = live.reduce((s, p) => s + num(p.total), 0);
  const payable = v.bills.reduce((s, b) => s + num(b.amount) - num(b.paid), 0);

  // On-time delivery: fully received orders where the last receipt came on/before the promised date
  const done = live.filter((p) => ["RECEIVED", "CLOSED"].includes(p.status) && p.deliveryDate && p.receipts.length);
  const onTime = done.filter((p) => new Date(Math.max(...p.receipts.map((r) => r.deliveryDate.getTime()))) <= new Date(p.deliveryDate!.getTime() + 86400000 - 1)).length;
  const onTimePct = done.length ? Math.round((onTime / done.length) * 100) : null;
  const late = live.filter((p) => ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"].includes(p.status) && p.deliveryDate && p.deliveryDate < startOfDay()).length;

  return (
    <>
      <PageHeader
        back={{ href: "/procurement/vendors", label: "All vendors" }}
        title={v.name}
        subtitle={`${v.code}${v.categories ? ` · ${v.categories}` : ""}`}
        actions={
          <>
            {c.can("vendors:edit") && <FormDialog title="Edit vendor" wide trigger={<Button variant="secondary">Edit</Button>} fields={vendorFields(v as unknown as Record<string, unknown>, money)} action={updateVendor.bind(null, id)} />}
            {c.can("purchase_orders:create") && <Link href={`/procurement/orders/new?vendorId=${id}`}><Button>New purchase order</Button></Link>}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orders placed" value={live.length} />
        <StatCard label="On-time delivery" value={onTimePct === null ? "—" : `${onTimePct}%`} tone={onTimePct !== null && onTimePct < 70 ? "bad" : "default"} sub={late ? `${late} order(s) running late` : undefined} />
        {money && <StatCard label="Total purchased" value={formatINR(purchased)} />}
        {money && <StatCard label="Payable now" value={formatINR(payable)} tone={payable > 0 ? "warn" : "default"} />}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Purchase orders</CardTitle></CardHeader>
            {v.purchaseOrders.length === 0 ? <EmptyState title="No orders yet" /> : (
              <ul className="divide-y divide-slate-100">
                {v.purchaseOrders.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1"><Link href={`/procurement/orders/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.number}</Link><p className="text-xs text-slate-500">{formatDate(p.orderDate)}{p.project ? ` · ${p.project.code}` : ""}{p.deliveryDate ? ` · due ${formatDate(p.deliveryDate)}` : ""}</p></div>
                    <span className="tabular text-sm">{formatINR(p.total)}</span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {money && (
            <Card>
              <CardHeader><CardTitle>Bills</CardTitle></CardHeader>
              {v.bills.length === 0 ? <EmptyState title="No bills recorded" /> : (
                <ul className="divide-y divide-slate-100">
                  {v.bills.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 px-5 py-3.5">
                      <div className="flex-1"><p className="font-medium">{b.number}</p><p className="text-xs text-slate-500">{formatDate(b.billDate)}{b.dueDate ? ` · due ${formatDate(b.dueDate)}` : ""}</p></div>
                      <span className="tabular text-sm">{formatINR(b.amount)}</span>
                      <StatusBadge status={b.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardBody>
              <DetailGrid items={[
                { label: "Contact", value: v.contactPerson }, { label: "Phone", value: v.phone }, { label: "WhatsApp", value: v.whatsapp }, { label: "Email", value: v.email },
                { label: "GSTIN", value: v.gstin }, { label: "PAN", value: v.pan }, { label: "Rating", value: v.rating ? "★".repeat(v.rating) : null }, { label: "Address", value: v.address },
                ...(money ? [{ label: "Bank details", value: v.bankDetails }] : []),
              ]} />
              {v.notes && <p className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-4 text-sm text-slate-700">{v.notes}</p>}
            </CardBody>
          </Card>
          {c.can("documents:view") && <DocumentsPanel c={c} entityType="VENDOR" entityId={id} />}
          {c.can("vendors:delete") && (
            <ActionButton variant="ghost" className="text-red-600 hover:bg-red-50" action={async () => { "use server"; const r = await deleteVendor(id); if (r.ok) redirect("/procurement/vendors"); return r; }} confirm={{ title: "Delete this vendor?", body: "Only possible when there are no orders or bills.", confirmLabel: "Delete vendor" }}>Delete vendor</ActionButton>
          )}
        </div>
      </div>
    </>
  );
}
