import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { clientOptions } from "@/lib/lookups";
import { toDateInput, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { InvoiceForm } from "../invoice-form";
import { createInvoice } from "../../actions";

export const metadata = { title: "New Invoice" };

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ clientId?: string; projectId?: string; quotationId?: string }> }) {
  const c = await requirePerm("invoices:create");
  const sp = await searchParams;
  const [clients, projects, settings, quote, project] = await Promise.all([
    clientOptions(c.companyId),
    db.project.findMany({ where: projectScope(c), select: { id: true, code: true, name: true, clientId: true }, orderBy: { createdAt: "desc" } }),
    db.companySettings.findUnique({ where: { companyId: c.companyId } }),
    sp.quotationId ? db.quotation.findFirst({ where: { id: sp.quotationId, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } } } }) : null,
    sp.projectId ? db.project.findFirst({ where: { id: sp.projectId, ...projectScope(c) } }) : null,
  ]);
  const tax = num(settings?.defaultTaxPercent ?? 18);
  const due = new Date(Date.now() + 15 * 86400000);
  return (
    <>
      <PageHeader back={{ href: "/finance/invoices", label: "Invoices" }} title="New invoice" subtitle={quote ? `Prefilled from quotation ${quote.number}.` : "Add the lines to bill. Totals and GST are calculated automatically."} />
      <InvoiceForm
        action={createInvoice} clients={clients} defaultTax={tax} cancelHref="/finance/invoices"
        projects={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}`, clientId: p.clientId }))}
        initial={{
          clientId: quote?.clientId ?? project?.clientId ?? sp.clientId, projectId: quote?.projectId ?? project?.id, quotationId: quote?.id,
          issueDate: toDateInput(new Date()), dueDate: toDateInput(due), paymentTerms: quote?.paymentTerms ?? "Payable within 15 days of invoice",
          discountPct: quote ? num(quote.discountPct) : 0,
          items: quote ? quote.items.map((i) => ({ description: i.description, unit: i.unit, quantity: num(i.quantity), rate: num(i.rate), taxPercent: num(i.taxPercent) })) : [],
        }}
      />
    </>
  );
}
