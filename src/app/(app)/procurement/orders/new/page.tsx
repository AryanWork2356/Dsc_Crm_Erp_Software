import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { vendorOptions } from "@/lib/lookups";
import { toDateInput, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { PoForm } from "../po-form";
import { createPurchaseOrder } from "../../actions";

export const metadata = { title: "New Purchase Order" };

export default async function NewPo({ searchParams }: { searchParams: Promise<{ vendorId?: string; requestId?: string; projectId?: string }> }) {
  const c = await requirePerm("purchase_orders:create");
  const sp = await searchParams;
  const [vendors, projects, materials, templates, settings, pr] = await Promise.all([
    vendorOptions(c.companyId),
    db.project.findMany({ where: { ...projectScope(c), status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true } }),
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true, purchaseCost: true, vendorId: true }, orderBy: { name: "asc" }, take: 2000 }),
    db.termsAndConditions.findMany({ where: { companyId: c.companyId, kind: "PO" }, orderBy: { isDefault: "desc" } }),
    db.companySettings.findUnique({ where: { companyId: c.companyId } }),
    sp.requestId ? db.purchaseRequest.findFirst({ where: { id: sp.requestId, companyId: c.companyId, status: "APPROVED" }, include: { items: true } }) : null,
  ]);
  const cost = new Map(materials.map((m) => [m.id, num(m.purchaseCost)]));
  const guessVendor = pr?.items.map((i) => materials.find((m) => m.id === i.materialId)?.vendorId).find(Boolean) ?? undefined;

  return (
    <>
      <PageHeader back={{ href: "/procurement/orders", label: "Purchase orders" }} title="New purchase order" subtitle={pr ? `From request ${pr.number}. Check rates before saving.` : "Choose the vendor and add what you're buying."} />
      <PoForm
        action={createPurchaseOrder}
        vendors={vendors}
        projects={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
        catalog={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, rate: num(m.purchaseCost) }))}
        templates={templates}
        defaultTax={num(settings?.defaultTaxPercent ?? 18)}
        cancelHref="/procurement/orders"
        initial={{
          vendorId: sp.vendorId ?? guessVendor ?? undefined, projectId: pr?.projectId ?? sp.projectId, requestId: pr?.id,
          deliveryDate: toDateInput(pr?.requiredDate ?? new Date(Date.now() + 7 * 86400000)), notes: templates.find((t) => t.isDefault)?.body,
          items: pr ? pr.items.map((i) => ({ description: i.description, unit: i.unit, quantity: num(i.quantity), rate: i.materialId ? cost.get(i.materialId) ?? "" : "", taxPercent: num(settings?.defaultTaxPercent ?? 18), materialId: i.materialId ?? undefined, boqItemId: i.boqItemId ?? undefined })) : [],
        }}
      />
    </>
  );
}
