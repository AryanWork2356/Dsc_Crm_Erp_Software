import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/scope";
import { clientOptions } from "@/lib/lookups";
import { toDateInput, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { QuotationForm } from "../../quotation-form";
import { updateQuotation } from "../../actions";

export const metadata = { title: "Edit Quotation" };

export default async function EditQuotation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("quotations:edit");
  const q = await db.quotation.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!q) notFound();
  if (!["DRAFT", "REJECTED"].includes(q.status)) redirect(`/sales/quotations/${id}`);

  const [clients, leads, templates, settings] = await Promise.all([
    clientOptions(c.companyId),
    db.lead.findMany({ where: leadScope(c), select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.termsAndConditions.findMany({ where: { companyId: c.companyId, kind: "QUOTATION" }, orderBy: { isDefault: "desc" } }),
    db.companySettings.findUnique({ where: { companyId: c.companyId } }),
  ]);

  return (
    <>
      <PageHeader back={{ href: `/sales/quotations/${id}`, label: q.number }} title={`Edit ${q.number}`} subtitle={`Revision ${q.revision}`} />
      <QuotationForm
        action={updateQuotation.bind(null, id)}
        clients={clients}
        leads={leads.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, body: t.body }))}
        defaultTax={num(settings?.defaultTaxPercent ?? 18)}
        cancelHref={`/sales/quotations/${id}`}
        initial={{
          clientId: q.clientId, leadId: q.leadId ?? undefined, title: q.title ?? undefined, date: toDateInput(q.date), validUntil: toDateInput(q.validUntil),
          terms: q.terms ?? undefined, paymentTerms: q.paymentTerms ?? undefined, notes: q.notes ?? undefined, discountPct: num(q.discountPct),
          items: q.items.map((i) => ({ category: i.category, description: i.description, unit: i.unit, quantity: num(i.quantity), rate: num(i.rate), taxPercent: num(i.taxPercent) })),
        }}
      />
    </>
  );
}
