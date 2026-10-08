import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog, type FieldDef } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { deleteTerms, saveTerms } from "./actions";

export const metadata = { title: "Terms Templates" };
const KINDS = [{ value: "QUOTATION", label: "Quotation" }, { value: "PO", label: "Purchase order" }, { value: "INVOICE", label: "Invoice" }];

export default async function TermsPage() {
  const c = await requirePerm("settings:view");
  const rows = await db.termsAndConditions.findMany({ where: { companyId: c.companyId }, orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { name: "asc" }] });
  const manage = c.can("settings:manage");
  const fields = (t?: (typeof rows)[number]): FieldDef[] => [
    { name: "kind", label: "Used on", type: "select", required: true, options: KINDS, defaultValue: t?.kind ?? "QUOTATION" },
    { name: "name", label: "Template name", required: true, defaultValue: t?.name ?? null },
    { name: "body", label: "Terms & conditions", type: "textarea", required: true, full: true, defaultValue: t?.body ?? null },
    { name: "isDefault", label: "Use as the default for new documents", type: "checkbox", defaultValue: t?.isDefault ?? false },
  ];
  return (
    <>
      <PageHeader title="Terms templates" subtitle="Ready-made terms & conditions that are filled into new quotations and purchase orders." actions={manage && <FormDialog title="New template" wide trigger={<Button>New template</Button>} fields={fields()} action={saveTerms.bind(null, null)} />} />
      {rows.length === 0 ? <Card><EmptyState title="No templates yet" /></Card> : KINDS.map((k) => {
        const list = rows.filter((r) => r.kind === k.value);
        if (!list.length) return null;
        return (
          <Card key={k.value} className="mb-5">
            <CardHeader><CardTitle>{k.label}</CardTitle></CardHeader>
            <ul className="divide-y divide-slate-100">
              {list.map((t) => (
                <li key={t.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{t.name}</p>{t.isDefault && <Badge tone="green">Default</Badge>}
                    {manage && <span className="ml-auto flex gap-1"><FormDialog title="Edit template" wide trigger={<Button size="sm" variant="ghost">Edit</Button>} fields={fields(t)} action={saveTerms.bind(null, t.id)} /><ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteTerms.bind(null, t.id)} confirm={{ title: `Delete “${t.name}”?`, confirmLabel: "Delete" }}>Delete</ActionButton></span>}</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{t.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </>
  );
}
