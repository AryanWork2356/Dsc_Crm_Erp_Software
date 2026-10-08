import Link from "next/link";
import type { DocumentType, Prisma } from "@prisma/client";
import { Download } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScope, leadScope, projectDocScope } from "@/lib/scope";
import { flatten, listParams } from "@/lib/list";
import { DOCUMENT_TYPE_OPTS } from "@/lib/enums";
import { ENTITY_TYPES } from "@/lib/doc-access";
import { formatDate, humanize, startOfDay } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { deleteDocument, uploadDocument } from "./actions";

export const metadata = { title: "Documents" };

/** Rows of the library the user is allowed to see (each download is re-checked individually). */
async function visibleWhere(c: Awaited<ReturnType<typeof requirePerm>>): Promise<Prisma.DocumentWhereInput> {
  const base: Prisma.DocumentWhereInput = { companyId: c.companyId, deletedAt: null };
  if (["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role) || c.can("documents:manage")) return base;
  const [projects, clients, leads] = await Promise.all([
    db.project.findMany({ where: projectDocScope(c), select: { id: true } }),
    db.client.findMany({ where: clientScope(c), select: { id: true } }),
    db.lead.findMany({ where: leadScope(c), select: { id: true } }),
  ]);
  const or: Prisma.DocumentWhereInput[] = [
    { uploadedById: c.userId },
    { entityType: "PROJECT", entityId: { in: projects.map((p) => p.id) } },
    { entityType: "CLIENT", entityId: { in: clients.map((p) => p.id) } },
    { entityType: "LEAD", entityId: { in: leads.map((p) => p.id) } },
  ];
  const byPerm: [string, Parameters<typeof c.can>[0]][] = [["VENDOR", "vendors:view"], ["PO", "purchase_orders:view"], ["EMPLOYEE", "employees:view"], ["INVOICE", "invoices:view"], ["SITE_VISIT", "sitevisits:view"], ["TICKET", "support:view"], ["QUOTATION", "quotations:view"], ["BOQ", "boq:view"]];
  for (const [t, p] of byPerm) if (c.can(p)) or.push({ entityType: t });
  return { ...base, OR: or };
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("documents:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 25);
  const vis = await visibleWhere(c);
  const soon = new Date(startOfDay().getTime() + 30 * 86400000);
  const where: Prisma.DocumentWhereInput = {
    AND: [vis, {
      ...(sp.type ? { type: sp.type as DocumentType } : {}),
      ...(sp.entity ? { entityType: sp.entity } : {}),
      ...(sp.folder ? { folder: { contains: sp.folder, mode: "insensitive" } } : {}),
      ...(sp.expiring ? { expiresAt: { lte: soon } } : {}),
      ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { tags: { contains: lp.q, mode: "insensitive" } }, { folder: { contains: lp.q, mode: "insensitive" } }] } : {}),
    }],
  };
  const [rows, total, expiring, projects, clients, vendors, folders] = await Promise.all([
    db.document.findMany({ where, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
    db.document.count({ where }),
    db.document.count({ where: { AND: [vis, { expiresAt: { lte: soon } }] } }),
    c.can("projects:view") ? db.project.findMany({ where: projectDocScope(c), select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" }, take: 300 }) : [],
    c.can("clients:view") ? db.client.findMany({ where: clientScope(c), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }) : [],
    c.can("vendors:view") ? db.vendor.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }) : [],
    db.document.findMany({ where: { AND: [vis, { folder: { not: null } }] }, distinct: ["folder"], select: { folder: true }, take: 50 }),
  ]);
  const names = new Map<string, string>([...projects.map((p) => [p.id, `${p.code} · ${p.name}`] as [string, string]), ...clients.map((p) => [p.id, p.name] as [string, string]), ...vendors.map((p) => [p.id, p.name] as [string, string])]);
  const attach = [{ value: "GENERAL", label: "General (company file)" }, ...projects.map((p) => ({ value: `PROJECT:${p.id}`, label: `Project – ${p.code} ${p.name}` })), ...clients.map((p) => ({ value: `CLIENT:${p.id}`, label: `Client – ${p.name}` })), ...vendors.map((p) => ({ value: `VENDOR:${p.id}`, label: `Vendor – ${p.name}` }))];

  return (
    <>
      <PageHeader title="Documents" subtitle="Contracts, drawings, photos and bills – all in one place, with the same access rules as the records they belong to." actions={c.can("documents:create") && (
        <FormDialog title="Upload a file" description="PDF, images, Excel, Word, CSV or text – up to 10 MB. Uploading the same name again saves a new version." wide trigger={<Button>Upload</Button>} fields={[
          { name: "file", label: "File", type: "file", required: true, full: true },
          { name: "attachTo", label: "Attach to", type: "select", options: attach, defaultValue: "GENERAL", full: true },
          { name: "type", label: "Document type", type: "select", options: DOCUMENT_TYPE_OPTS, defaultValue: "OTHER" },
          { name: "name", label: "Name (optional)" }, { name: "folder", label: "Folder" }, { name: "tags", label: "Tags" },
          { name: "expiresAt", label: "Expires on (optional)", type: "date" },
        ]} action={uploadDocument} submitLabel="Upload" />
      )} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3"><StatCard label="Files" value={total} /><StatCard label="Expiring in 30 days" value={expiring} tone={expiring ? "warn" : "good"} href="/documents?expiring=1" /></div>
      <Card>
        <ListFilters placeholder="Search name, tag or folder…" filters={[{ key: "type", label: "Type", options: DOCUMENT_TYPE_OPTS }, { key: "entity", label: "Attached to", options: ENTITY_TYPES.map((e) => ({ value: e, label: humanize(e) })) }, ...(folders.length ? [{ key: "folder", label: "Folder", options: folders.map((f) => ({ value: f.folder!, label: f.folder! })) }] : [])]} />
        {rows.length === 0 ? <EmptyState title="No documents found" /> : (
          <>
            <Table>
              <THead><tr><Th>File</Th><Th>Type</Th><Th>Attached to</Th><Th>Folder</Th><Th>Added</Th><Th /></tr></THead>
              <tbody>
                {rows.map((d) => {
                  const href = d.entityType === "PROJECT" ? `/projects/${d.entityId}?tab=documents` : d.entityType === "CLIENT" ? `/crm/clients/${d.entityId}` : d.entityType === "VENDOR" ? `/procurement/vendors/${d.entityId}` : d.entityType === "LEAD" ? `/crm/leads/${d.entityId}` : null;
                  const expired = d.expiresAt && d.expiresAt < startOfDay();
                  return (
                    <Tr key={d.id}>
                      <Td><p className="font-medium text-slate-900">{d.name} {d.version > 1 && <Badge tone="blue">v{d.version}</Badge>}</p><p className="text-xs text-slate-500">{(d.size / 1024).toFixed(0)} KB{d.tags ? ` · ${d.tags}` : ""}{d.expiresAt ? ` · ${expired ? "EXPIRED" : "expires"} ${formatDate(d.expiresAt)}` : ""}</p></Td>
                      <Td>{humanize(d.type)}</Td>
                      <Td>{href ? <Link className="text-brand-700 hover:underline" href={href}>{humanize(d.entityType ?? "")}{d.entityId && names.get(d.entityId) ? ` – ${names.get(d.entityId)}` : ""}</Link> : humanize(d.entityType ?? "General")}</Td>
                      <Td>{d.folder ?? "—"}</Td><Td>{formatDate(d.createdAt)}</Td>
                      <Td right>
                        <div className="flex justify-end gap-1">
                          <a href={`/documents/${d.id}/download`} className="rounded p-2 text-brand-700 hover:bg-brand-50" aria-label={`Download ${d.name}`}><Download className="h-4 w-4" /></a>
                          {(c.can("documents:delete") || d.uploadedById === c.userId) && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteDocument.bind(null, d.id)} confirm={{ title: `Remove “${d.name}”?`, confirmLabel: "Remove" }}>Remove</ActionButton>}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/documents" />
          </>
        )}
      </Card>
    </>
  );
}
