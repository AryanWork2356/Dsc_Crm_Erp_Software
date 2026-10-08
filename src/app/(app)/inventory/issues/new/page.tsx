import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { IssueForm } from "../issue-form";
import { createIssue, createReturn } from "../../actions";

export const metadata = { title: "Issue Material" };

export default async function NewIssue({ searchParams }: { searchParams: Promise<{ mode?: string; projectId?: string }> }) {
  const c = await requirePerm("inventory:create");
  const sp = await searchParams;
  const mode = sp.mode === "return" ? "return" : "issue";
  const [projects, warehouses, materials, balances, sites] = await Promise.all([
    db.project.findMany({ where: { ...projectScope(c), status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" } }),
    db.warehouse.findMany({ where: { companyId: c.companyId, isActive: true, type: "WAREHOUSE" }, orderBy: { name: "asc" } }),
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" } }),
    db.stockBalance.findMany({ where: { companyId: c.companyId, quantity: { gt: 0 } }, select: { locationId: true, materialId: true, quantity: true, reserved: true } }),
    db.warehouse.findMany({ where: { companyId: c.companyId, type: "SITE", projectId: { not: null } }, select: { id: true, projectId: true } }),
  ]);
  const stock: Record<string, Record<string, number>> = {};
  for (const b of balances) (stock[b.locationId] ??= {})[b.materialId] = num(b.quantity) - num(b.reserved);
  const siteOf = Object.fromEntries(sites.map((s) => [s.projectId!, s.id]));
  return (
    <>
      <PageHeader back={{ href: "/inventory/issues", label: "Issues & returns" }} title={mode === "issue" ? "Issue material to site" : "Return material from site"} subtitle={mode === "issue" ? "Moves stock from a warehouse to the project's site store and charges its cost to the project." : "Unused material goes back to the warehouse and the project is credited."} />
      <IssueForm
        mode={mode} action={mode === "issue" ? createIssue : createReturn} defaultProject={sp.projectId}
        projects={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
        warehouses={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        materials={materials.map((m) => ({ value: m.id, label: m.name, unit: m.unit }))}
        stock={stock} siteOf={siteOf}
      />
    </>
  );
}
