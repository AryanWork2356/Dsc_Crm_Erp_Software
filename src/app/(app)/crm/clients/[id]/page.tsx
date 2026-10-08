import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/scope";
import { PM_ROLES, userOptions } from "@/lib/lookups";
import { formatDate, formatINR, num } from "@/lib/utils";
import { PageHeader, DetailGrid, StatCard } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { deleteClient, updateClient } from "../../actions";
import { clientFields } from "../client-fields";
import { DocumentsPanel } from "@/components/documents/documents-panel";

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("clients:view");
  const cl = await db.client.findFirst({
    where: { id, ...clientScope(c) },
    include: {
      leads: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      projects: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      quotations: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 10 },
      invoices: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 10 },
      tickets: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!cl) notFound();

  const pms = await userOptions(c.companyId, PM_ROLES);
  const pm = pms.find((p) => p.value === cl.projectManagerId)?.label;
  const finance = c.can("finance:view");
  const billed = cl.invoices.filter((i) => !["DRAFT", "CANCELLED"].includes(i.status)).reduce((s, i) => s + num(i.total), 0);
  const paid = cl.invoices.filter((i) => i.status !== "CANCELLED").reduce((s, i) => s + num(i.paid), 0);

  return (
    <>
      <PageHeader
        back={{ href: "/crm/clients", label: "All clients" }}
        title={cl.name}
        subtitle={`${cl.code}${cl.companyName ? ` · ${cl.companyName}` : ""}`}
        actions={c.can("clients:edit") && <FormDialog title="Edit client" wide trigger={<Button variant="secondary">Edit</Button>} fields={clientFields(pms, cl as unknown as Record<string, unknown>)} action={updateClient.bind(null, id)} />}
      />
      {finance && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Projects" value={cl.projects.length} />
          <StatCard label="Billed" value={formatINR(billed)} />
          <StatCard label="Received" value={formatINR(paid)} tone="good" />
          <StatCard label="Outstanding" value={formatINR(billed - paid)} tone={billed - paid > 0 ? "warn" : "default"} />
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
            <CardBody>
              <DetailGrid items={[
                { label: "Phone", value: cl.phone }, { label: "Email", value: cl.email }, { label: "Project manager", value: pm },
                { label: "GSTIN", value: cl.gstin }, { label: "PAN", value: cl.pan }, { label: "Client since", value: formatDate(cl.createdAt) },
                { label: "Address", value: cl.address }, { label: "Billing address", value: cl.billingAddress ?? cl.address },
              ]} />
              {cl.notes && <p className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-4 text-sm text-slate-700">{cl.notes}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Projects</CardTitle></CardHeader>
            <CardBody className="py-2">
              {cl.projects.length === 0 && <p className="py-3 text-sm text-slate-500">No projects yet. Accepted quotations can be converted into projects.</p>}
              {cl.projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0">
                  <div><p className="font-medium text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{p.code}</p></div>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Quotations</CardTitle></CardHeader>
            <CardBody className="py-2">
              {cl.quotations.length === 0 && <p className="py-3 text-sm text-slate-500">No quotations yet.</p>}
              {cl.quotations.map((q) => (
                <div key={q.id} className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0">
                  <div><p className="font-medium text-slate-900">{q.number} <span className="text-xs text-slate-500">rev {q.revision}</span></p><p className="text-xs text-slate-500">{formatDate(q.date)}</p></div>
                  <div className="flex items-center gap-3"><span className="tabular text-sm">{formatINR(q.total)}</span><StatusBadge status={q.status} /></div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-5">
          {c.can("documents:view") && <DocumentsPanel c={c} entityType="CLIENT" entityId={id} />}
          <Card>
            <CardHeader><CardTitle>Original leads</CardTitle></CardHeader>
            <CardBody className="py-2">
              {cl.leads.length === 0 && <p className="py-3 text-sm text-slate-500">Added directly (no lead).</p>}
              {cl.leads.map((l) => (
                <Link key={l.id} href={`/crm/leads/${l.id}`} className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0 hover:text-brand-700">
                  <span className="text-sm">{l.code}</span><StatusBadge status={l.stage} />
                </Link>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Support tickets</CardTitle></CardHeader>
            <CardBody className="py-2">
              {cl.tickets.length === 0 && <p className="py-3 text-sm text-slate-500">No tickets.</p>}
              {cl.tickets.map((t) => (
                <div key={t.id} className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0">
                  <span className="truncate pr-2 text-sm">{t.subject}</span><StatusBadge status={t.status} />
                </div>
              ))}
            </CardBody>
          </Card>
          {c.can("clients:delete") && (
            <ActionButton
              variant="ghost" className="text-red-600 hover:bg-red-50"
              action={async () => {
                "use server";
                const r = await deleteClient(id);
                if (r.ok) redirect("/crm/clients");
                return r;
              }}
              confirm={{ title: "Delete this client?", body: "Only possible when the client has no projects, quotations or invoices.", confirmLabel: "Delete client" }}
            >
              Delete client
            </ActionButton>
          )}
        </div>
      </div>
    </>
  );
}
