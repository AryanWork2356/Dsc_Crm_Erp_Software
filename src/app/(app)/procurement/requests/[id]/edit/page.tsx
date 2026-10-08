import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { toDateInput, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { PrForm } from "../../pr-form";
import { updatePurchaseRequest } from "../../../actions";

export default async function EditRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("purchase_requests:edit");
  const pr = await db.purchaseRequest.findFirst({ where: { id, companyId: c.companyId }, include: { items: true } });
  if (!pr) notFound();
  if (!["DRAFT", "REJECTED"].includes(pr.status)) redirect(`/procurement/requests/${id}`);
  const [projects, materials] = await Promise.all([
    db.project.findMany({ where: { ...projectScope(c), status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" } }),
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" }, take: 2000 }),
  ]);
  return (
    <>
      <PageHeader back={{ href: `/procurement/requests/${id}`, label: pr.number }} title={`Edit ${pr.number}`} />
      <PrForm
        action={updatePurchaseRequest.bind(null, id)}
        projects={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
        catalog={materials}
        cancelHref={`/procurement/requests/${id}`}
        initial={{ projectId: pr.projectId ?? undefined, requiredDate: toDateInput(pr.requiredDate), reason: pr.reason ?? undefined, priority: pr.priority, items: pr.items.map((i) => ({ description: i.description, unit: i.unit, quantity: num(i.quantity), materialId: i.materialId, boqItemId: i.boqItemId })) }}
      />
    </>
  );
}
