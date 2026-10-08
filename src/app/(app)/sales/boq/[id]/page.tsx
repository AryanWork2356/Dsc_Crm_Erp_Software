import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientOptions } from "@/lib/lookups";
import { num, formatDateTime } from "@/lib/utils";
import { PageHeader, Alert } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { createQuotationFromBoq } from "../../quotations/actions";
import { deleteBoq, importBoqItems, reviseBoq, saveBoqItems, submitBoq } from "../actions";
import { BoqEditor, toEditorItem } from "./boq-editor";

export default async function BoqDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("boq:view");
  const b = await db.boq.findFirst({
    where: { id, companyId: c.companyId, deletedAt: null },
    include: { items: { orderBy: { sortOrder: "asc" } }, project: { select: { id: true, code: true, name: true } } },
  });
  if (!b) notFound();

  const canCosts = c.can("margins:view");
  const edit = c.can("boq:edit");
  const editable = edit && b.status === "DRAFT";
  const [materials, clients, pending, siblings] = await Promise.all([
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true, purchaseCost: true }, orderBy: { name: "asc" }, take: 2000 }),
    c.can("quotations:create") ? clientOptions(c.companyId) : [],
    b.status === "PENDING_APPROVAL" ? db.approval.findFirst({ where: { companyId: c.companyId, entityType: "Boq", entityId: id, status: "PENDING" } }) : null,
    db.boq.findMany({ where: { companyId: c.companyId, deletedAt: null, number: { startsWith: b.number.replace(/-R\d+$/, "") } }, orderBy: { revision: "asc" }, select: { id: true, number: true, revision: true, status: true } }),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/sales/boq", label: "All BOQs" }}
        title={`${b.number} · ${b.title}`}
        subtitle={b.project ? <>Project: <Link className="text-brand-700 hover:underline" href={`/projects/${b.project.id}`}>{b.project.code} – {b.project.name}</Link> · updated {formatDateTime(b.updatedAt)}</> : `Updated ${formatDateTime(b.updatedAt)}`}
        actions={
          <>
            <StatusBadge status={b.status} />
            <a href={`/sales/boq/${id}/pdf`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><FileDown className="h-4 w-4" /> PDF</Button></a>
            {c.can("boq:export") && <a href={`/sales/boq/${id}/export`}><Button size="sm" variant="secondary"><FileSpreadsheet className="h-4 w-4" /> Excel</Button></a>}
            {editable && (
              <FormDialog
                title="Import items from Excel"
                description="Columns: Category, Item, Specification, Unit, Quantity, Material Cost, Labour Cost, Other Cost, Selling Rate. Rows are added to the end."
                trigger={<Button size="sm" variant="secondary">Import</Button>}
                fields={[{ name: "file", label: "Excel file (.xlsx)", type: "file", required: true, hint: "Download the template for the exact layout." }]}
                action={importBoqItems.bind(null, id)}
                submitLabel="Import"
              />
            )}
            {editable && (
              // file download (route handler), not a page – a plain link is correct here
              <a href="/sales/boq/template" download><Button size="sm" variant="ghost">Template</Button></a>
            )}
            {edit && b.status === "DRAFT" && b.items.length > 0 && <ActionButton size="sm" action={submitBoq.bind(null, id)}>Submit for approval</ActionButton>}
            {edit && b.status === "APPROVED" && <ActionButton size="sm" variant="secondary" action={reviseBoq.bind(null, id)} confirm={{ title: "Create a revision?", body: "A copy is created for editing and this version is marked Revised.", confirmLabel: "Create revision" }}>Revise</ActionButton>}
            {clients.length > 0 && b.items.length > 0 && (
              <FormDialog
                title="Create quotation from this BOQ"
                description="Copies item names, quantities and selling rates. Internal costs are never copied."
                trigger={<Button size="sm" variant="secondary">Create quotation</Button>}
                fields={[{ name: "clientId", label: "Client", type: "select", options: clients, required: true }]}
                action={createQuotationFromBoq.bind(null, id)}
                submitLabel="Create quotation"
              />
            )}
            {c.can("boq:delete") && b.status === "DRAFT" && (
              <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={async () => { "use server"; const r = await deleteBoq(id); if (r.ok) redirect("/sales/boq"); return r; }} confirm={{ title: "Delete this BOQ?", confirmLabel: "Delete" }}>Delete</ActionButton>
            )}
          </>
        }
      />
      {pending && <div className="mb-4"><Alert tone="warn">Waiting for Management approval. <Link href="/approvals" className="font-medium underline">Open approvals</Link></Alert></div>}
      {b.status === "REVISED" && <div className="mb-4"><Alert>This version has been superseded. {siblings.filter((s) => s.revision > b.revision).map((s) => <Link key={s.id} href={`/sales/boq/${s.id}`} className="ml-1 font-medium underline">{s.number}</Link>)}</Alert></div>}
      {b.status === "APPROVED" && edit && <div className="mb-4"><Alert tone="info">Approved BOQs are locked. Use <b>Revise</b> to make changes.</Alert></div>}
      {siblings.length > 1 && (
        <p className="mb-4 text-sm text-slate-600">
          Versions: {siblings.map((s) => <Link key={s.id} href={`/sales/boq/${s.id}`} className={s.id === id ? "mr-2 font-semibold text-slate-900" : "mr-2 text-brand-700 hover:underline"}>{s.number}</Link>)}
          {siblings.length >= 2 && <Link className="ml-2 font-medium text-brand-700 hover:underline" href={`/sales/boq/compare?a=${siblings[siblings.length - 2].id}&b=${siblings[siblings.length - 1].id}`}>Compare latest two →</Link>}
        </p>
      )}

      <BoqEditor
        editable={editable}
        canCosts={canCosts}
        save={saveBoqItems.bind(null, id)}
        catalog={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, cost: num(m.purchaseCost) }))}
        initial={b.items.map((i) => toEditorItem({
          id: i.id, category: i.category, item: i.item, specification: i.specification ?? "", unit: i.unit, quantity: num(i.quantity),
          materialCost: num(i.materialCost), labourCost: num(i.labourCost), otherCost: num(i.otherCost), sellingRate: num(i.sellingRate), materialId: i.materialId,
        }))}
      />
    </>
  );
}
