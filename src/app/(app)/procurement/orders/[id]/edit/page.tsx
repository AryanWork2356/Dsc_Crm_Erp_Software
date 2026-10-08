import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { vendorOptions } from "@/lib/lookups";
import { toDateInput, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { PoForm } from "../../po-form";
import { updatePurchaseOrder } from "../../../actions";

export default async function EditPo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("purchase_orders:edit");
  const po = await db.purchaseOrder.findFirst({ where: { id, companyId: c.companyId }, include: { items: true } });
  if (!po) notFound();
  if (po.status !== "DRAFT") redirect(`/procurement/orders/${id}`);
  const [vendors, projects, materials, templates, settings] = await Promise.all([
    vendorOptions(c.companyId),
    db.project.findMany({ where: { ...projectScope(c) }, select: { id: true, code: true, name: true } }),
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true, purchaseCost: true }, orderBy: { name: "asc" }, take: 2000 }),
    db.termsAndConditions.findMany({ where: { companyId: c.companyId, kind: "PO" } }),
    db.companySettings.findUnique({ where: { companyId: c.companyId } }),
  ]);
  const disc = num(po.subtotal) > 0 ? (num(po.discountAmount) / num(po.subtotal)) * 100 : 0;
  return (
    <>
      <PageHeader back={{ href: `/procurement/orders/${id}`, label: po.number }} title={`Edit ${po.number}`} />
      <PoForm
        action={updatePurchaseOrder.bind(null, id)}
        vendors={vendors}
        projects={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
        catalog={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, rate: num(m.purchaseCost) }))}
        templates={templates}
        defaultTax={num(settings?.defaultTaxPercent ?? 18)}
        cancelHref={`/procurement/orders/${id}`}
        initial={{
          vendorId: po.vendorId, projectId: po.projectId ?? undefined, requestId: po.requestId ?? undefined, deliveryDate: toDateInput(po.deliveryDate),
          paymentTerms: po.paymentTerms ?? undefined, notes: po.notes ?? undefined, discountPct: Math.round(disc * 100) / 100,
          items: po.items.map((i) => ({ description: i.description, unit: i.unit, quantity: num(i.quantity), rate: num(i.rate), taxPercent: num(i.taxPercent), materialId: i.materialId ?? undefined, boqItemId: i.boqItemId ?? undefined })),
        }}
      />
    </>
  );
}
