import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { toDateInput, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { PrForm } from "../pr-form";
import { createPurchaseRequest } from "../../actions";

export const metadata = { title: "New Purchase Request" };

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ projectId?: string; boq?: string }> }) {
  const c = await requirePerm("purchase_requests:create");
  const sp = await searchParams;
  const [projects, materials, boq] = await Promise.all([
    db.project.findMany({ where: { ...projectScope(c), status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" } }),
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" }, take: 2000 }),
    sp.boq ? db.boq.findFirst({ where: { id: sp.boq, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } } } }) : null,
  ]);
  const boqOk = boq && (!boq.projectId || projects.some((p) => p.id === boq.projectId));

  return (
    <>
      <PageHeader back={{ href: "/procurement/requests", label: "Purchase requests" }} title="New purchase request" subtitle={boqOk ? `Prefilled from ${boq.number} – remove what you don't need to order now.` : "List what you need. It goes for approval before procurement orders it."} />
      <PrForm
        action={createPurchaseRequest}
        projects={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
        catalog={materials}
        cancelHref="/procurement/requests"
        initial={{
          projectId: (boqOk ? boq.projectId : sp.projectId) ?? undefined,
          requiredDate: toDateInput(new Date(Date.now() + 7 * 86400000)),
          items: boqOk ? boq.items.map((i) => ({ description: i.item, unit: i.unit, quantity: num(i.quantity), materialId: i.materialId, boqItemId: i.id })) : [],
        }}
      />
    </>
  );
}
