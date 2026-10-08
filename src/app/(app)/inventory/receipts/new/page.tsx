import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { toDateInput, num, formatDate } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ReceiptForm } from "../receipt-form";
import { createReceipt } from "../../actions";

export const metadata = { title: "Receive Material" };

export default async function NewReceipt({ searchParams }: { searchParams: Promise<{ poId?: string }> }) {
  const c = await requirePerm("inventory:create");
  const { poId } = await searchParams;

  if (!poId) {
    const open = await db.purchaseOrder.findMany({ where: { companyId: c.companyId, status: { in: ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] } }, include: { vendor: { select: { name: true } } }, orderBy: { deliveryDate: "asc" } });
    return (
      <>
        <PageHeader back={{ href: "/inventory/receipts", label: "Receipts" }} title="Receive material" subtitle="Choose the purchase order the delivery belongs to." />
        <Card>
          {open.length === 0 ? <EmptyState title="No open purchase orders" hint="Orders must be approved before material can be received." /> : (
            <ul className="divide-y divide-slate-100">
              {open.map((p) => <li key={p.id}><Link href={`/inventory/receipts/new?poId=${p.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50"><span className="font-medium text-slate-900">{p.number}</span><span className="text-sm text-slate-500">{p.vendor.name}</span><span className="ml-auto text-sm text-slate-500">due {formatDate(p.deliveryDate)}</span><StatusBadge status={p.status} /></Link></li>)}
            </ul>
          )}
        </Card>
      </>
    );
  }

  const po = await db.purchaseOrder.findFirst({ where: { id: poId, companyId: c.companyId }, include: { items: true, vendor: true } });
  if (!po) redirect("/inventory/receipts/new");
  if (!["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"].includes(po.status)) redirect(`/procurement/orders/${poId}`);
  const locations = await db.warehouse.findMany({ where: { companyId: c.companyId, isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] });
  const projectSite = po.projectId ? locations.find((l) => l.projectId === po.projectId) : undefined;

  return (
    <>
      <PageHeader back={{ href: `/procurement/orders/${poId}`, label: po.number }} title={`Receive material – ${po.number}`} subtitle={`${po.vendor.name}. Accepted quantities are added to stock; damaged and rejected ones are not.`} />
      <ReceiptForm
        poId={po.id} poNumber={po.number} today={toDateInput(new Date())} action={createReceipt}
        locations={locations.map((l) => ({ value: l.id, label: `${l.name}${l.type === "SITE" ? " (site)" : ""}` }))}
        defaultLocation={projectSite?.id ?? locations.find((l) => l.type === "WAREHOUSE")?.id}
        items={po.items.map((i) => ({ id: i.id, description: i.description, unit: i.unit, ordered: num(i.quantity), received: num(i.receivedQty), stockable: !!i.materialId }))}
      />
    </>
  );
}
