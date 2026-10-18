import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { TransferForm } from "../transfer-form";

export const metadata = { title: "New transfer" };

export default async function NewTransferPage() {
  const c = await requirePerm("transfers:create");
  const open = { notIn: ["COMPLETED", "CANCELLED"] as ("COMPLETED" | "CANCELLED")[] };
  const [mine, all, materials, stock, workers] = await Promise.all([
    db.project.findMany({ where: { ...projectScope(c), status: open }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    db.project.findMany({ where: { companyId: c.companyId, deletedAt: null, status: open }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" }, take: 2000 }),
    db.stockBalance.findMany({ where: { companyId: c.companyId, location: { type: "SITE" }, quantity: { gt: 0 } }, select: { materialId: true, quantity: true, reserved: true, location: { select: { projectId: true } } } }),
    db.worker.findMany({ where: { companyId: c.companyId, isActive: true, deletedAt: null, currentProjectId: { not: null } }, select: { id: true, name: true, trade: true, currentProjectId: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader back={{ href: "/transfers", label: "Transfers" }} title="New transfer" subtitle="Move material or workers to another project. The project manager of the first project approves it." />
      <TransferForm
        from={mine.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` }))}
        to={all.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` }))}
        materials={materials}
        stock={stock.filter((s) => s.location.projectId).map((s) => ({ projectId: s.location.projectId!, materialId: s.materialId, qty: num(s.quantity) - num(s.reserved) }))}
        workers={workers.map((w) => ({ id: w.id, name: w.name, trade: w.trade, projectId: w.currentProjectId! }))}
      />
    </div>
  );
}
