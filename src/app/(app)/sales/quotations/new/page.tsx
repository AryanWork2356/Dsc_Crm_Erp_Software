import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/scope";
import { clientOptions } from "@/lib/lookups";
import { toDateInput, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { QuotationForm } from "../quotation-form";
import { createQuotation } from "../actions";

export const metadata = { title: "New Quotation" };

export default async function NewQuotation({ searchParams }: { searchParams: Promise<{ clientId?: string; leadId?: string }> }) {
  const c = await requirePerm("quotations:create");
  const sp = await searchParams;
  const [clients, leads, templates, settings, lead] = await Promise.all([
    clientOptions(c.companyId),
    db.lead.findMany({ where: leadScope(c), select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.termsAndConditions.findMany({ where: { companyId: c.companyId, kind: "QUOTATION" }, orderBy: { isDefault: "desc" } }),
    db.companySettings.findUnique({ where: { companyId: c.companyId } }),
    sp.leadId ? db.lead.findFirst({ where: { id: sp.leadId, ...leadScope(c) } }) : null,
  ]);
  const validity = new Date(Date.now() + 30 * 86400000);

  return (
    <>
      <PageHeader back={{ href: "/sales/quotations", label: "Quotations" }} title="New quotation" subtitle="Add the line items. Totals and GST are calculated automatically." />
      <QuotationForm
        action={createQuotation}
        clients={clients}
        leads={leads.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, body: t.body }))}
        defaultTax={num(settings?.defaultTaxPercent ?? 18)}
        cancelHref="/sales/quotations"
        initial={{
          clientId: sp.clientId ?? lead?.clientId ?? undefined,
          leadId: sp.leadId,
          title: lead?.projectType ?? undefined,
          date: toDateInput(new Date()),
          validUntil: toDateInput(validity),
          terms: templates.find((t) => t.isDefault)?.body,
          items: [],
        }}
      />
    </>
  );
}
