import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { clientOptions } from "@/lib/lookups";
import { toDateInput, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { InvoiceForm } from "../../invoice-form";
import { updateInvoice } from "../../../actions";

export default async function EditInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("invoices:edit");
  const inv = await db.invoice.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { items: true } });
  if (!inv) notFound();
  if (inv.status !== "DRAFT") redirect(`/finance/invoices/${id}`);
  const [clients, projects, settings] = await Promise.all([
    clientOptions(c.companyId),
    db.project.findMany({ where: projectScope(c), select: { id: true, code: true, name: true, clientId: true } }),
    db.companySettings.findUnique({ where: { companyId: c.companyId } }),
  ]);
  const disc = num(inv.subtotal) > 0 ? (num(inv.discount) / num(inv.subtotal)) * 100 : 0;
  return (
    <>
      <PageHeader back={{ href: `/finance/invoices/${id}`, label: inv.number }} title={`Edit ${inv.number}`} />
      <InvoiceForm
        action={updateInvoice.bind(null, id)} clients={clients} defaultTax={num(settings?.defaultTaxPercent ?? 18)} cancelHref={`/finance/invoices/${id}`}
        projects={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}`, clientId: p.clientId }))}
        initial={{ clientId: inv.clientId, projectId: inv.projectId ?? undefined, quotationId: inv.quotationId ?? undefined, issueDate: toDateInput(inv.issueDate), dueDate: toDateInput(inv.dueDate), paymentTerms: inv.paymentTerms ?? undefined, notes: inv.notes ?? undefined, discountPct: Math.round(disc * 100) / 100, items: inv.items.map((i) => ({ description: i.description, unit: i.unit, quantity: num(i.quantity), rate: num(i.rate), taxPercent: num(i.taxPercent) })) }}
      />
    </>
  );
}
