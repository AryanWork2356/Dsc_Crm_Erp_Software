import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { toDateInput, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { needBoard } from "@/lib/material-needs";
import { PrForm } from "../pr-form";
import { createPurchaseRequest } from "../../actions";

export const metadata = { title: "New Purchase Request" };

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ projectId?: string; boq?: string; need?: string }> }) {
  const c = await requirePerm("purchase_requests:create");
  const sp = await searchParams;
  const [projects, materials, boq] = await Promise.all([
    db.project.findMany({ where: { ...projectScope(c), status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" } }),
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" }, take: 2000 }),
    sp.boq ? db.boq.findFirst({ where: { id: sp.boq, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } } } }) : null,
  ]);
  const boqOk = boq && (!boq.projectId || projects.some((p) => p.id === boq.projectId));
  // "Ask for it" from a project's materials list: that material, the part nobody has asked for yet, and the day it is needed
  const needRec = !boqOk && sp.need ? await db.materialNeed.findFirst({ where: { id: sp.need, companyId: c.companyId, projectId: { in: projects.map((p) => p.id) } }, select: { id: true, projectId: true } }) : null;
  const need = needRec ? (await needBoard(c.companyId, [needRec.projectId])).find((r) => r.id === needRec.id) : undefined;
  const needItem = need ? { description: need.description, unit: need.unit, quantity: Math.max(need.quantity - need.arrived - need.ordered - need.asked, 0) || need.quantity, materialId: need.materialId } : null;

  return (
    <>
      <PageHeader back={{ href: "/procurement/requests", label: "Purchase requests" }} title="New purchase request" subtitle={boqOk ? `Prefilled from ${boq.number} – remove what you don't need to order now.` : need ? `From the materials list of ${need.projectCode}: the quantity not yet asked for, needed on site by ${toDateInput(need.neededBy)}.` : "List what you need. It goes for approval before procurement orders it."} />
      <PrForm
        noticeDays={(await db.companySettings.findUnique({ where: { companyId: c.companyId }, select: { materialNoticeDays: true } }))?.materialNoticeDays ?? 2}
        action={createPurchaseRequest}
        projects={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
        catalog={materials}
        cancelHref="/procurement/requests"
        initial={{
          projectId: (boqOk ? boq.projectId : need ? need.projectId : sp.projectId) ?? undefined,
          requiredDate: toDateInput(need ? need.neededBy : new Date(Date.now() + 7 * 86400000)),
          reason: need ? `For the schedule${need.forWork ? `: ${need.forWork}` : ""}` : undefined,
          items: boqOk ? boq.items.map((i) => ({ description: i.item, unit: i.unit, quantity: num(i.quantity), materialId: i.materialId, boqItemId: i.id })) : needItem ? [needItem] : [],
        }}
      />
    </>
  );
}
