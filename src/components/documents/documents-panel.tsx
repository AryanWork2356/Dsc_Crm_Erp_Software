import { FileText, Image as ImageIcon, Download } from "lucide-react";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth";
import { DOCUMENT_TYPE_OPTS } from "@/lib/enums";
import { formatDate, humanize } from "@/lib/utils";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { deleteDocument, setPortalVisibility, uploadDocument } from "@/app/(app)/documents/actions";

const SHAREABLE = ["PROJECT", "QUOTATION", "INVOICE", "BOQ", "PO", "TICKET"];

/** Files attached to one record (project, client, vendor…). Upload, download, version history, delete. */
export async function DocumentsPanel({ c, entityType, entityId, title = "Documents" }: { c: Ctx; entityType: string; entityId: string; title?: string }) {
  const docs = await db.document.findMany({ where: { companyId: c.companyId, entityType, entityId, deletedAt: null }, orderBy: [{ name: "asc" }, { version: "desc" }] });
  const latest = docs.filter((d, i) => docs.findIndex((x) => x.name.toLowerCase() === d.name.toLowerCase()) === i);
  const users = await db.user.findMany({ where: { id: { in: [...new Set(docs.map((d) => d.uploadedById).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const who = new Map(users.map((u) => [u.id, u.name]));
  const canShare = c.can("documents:edit") && SHAREABLE.includes(entityType);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title} ({latest.length})</CardTitle>
        {c.can("documents:create") && (
          <FormDialog
            title="Upload a file" description="PDF, images, Excel, Word, CSV or text – up to 10 MB. Uploading a file with the same name saves a new version." wide
            trigger={<Button size="sm">Upload</Button>}
            fields={[
              { name: "entityType", label: "Type", type: "hidden", defaultValue: entityType }, { name: "entityId", label: "Id", type: "hidden", defaultValue: entityId },
              { name: "file", label: "File", type: "file", required: true, full: true },
              { name: "type", label: "Document type", type: "select", options: DOCUMENT_TYPE_OPTS, defaultValue: "OTHER" },
              { name: "name", label: "Name (optional)", hint: "Defaults to the file name" },
              { name: "folder", label: "Folder", placeholder: "e.g. Drawings / Rev 2" }, { name: "tags", label: "Tags", placeholder: "comma separated" },
              { name: "expiresAt", label: "Expires on (optional)", type: "date", hint: "You'll be reminded before it expires" },
              ...(canShare ? [{ name: "isPortalVisible", label: "Share with client / vendor portal", type: "checkbox" as const }] : []),
            ]}
            action={uploadDocument} submitLabel="Upload"
          />
        )}
      </CardHeader>
      {latest.length === 0 ? <EmptyState title="No files yet" hint="Upload drawings, photos, contracts or bills." /> : (
        <ul className="divide-y divide-slate-100">
          {latest.map((d) => {
            const older = docs.filter((x) => x.name.toLowerCase() === d.name.toLowerCase() && x.id !== d.id);
            const Icon = d.mimeType.startsWith("image/") ? ImageIcon : FileText;
            return (
              <li key={d.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <Icon className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">{d.name} {d.version > 1 && <Badge tone="blue">v{d.version}</Badge>} {d.isPortalVisible && <Badge tone="teal">Shared</Badge>}</p>
                    <p className="text-xs text-slate-500">{humanize(d.type)} · {(d.size / 1024).toFixed(0)} KB · {formatDate(d.createdAt)}{d.uploadedById ? ` · ${who.get(d.uploadedById) ?? ""}` : ""}{d.expiresAt ? ` · expires ${formatDate(d.expiresAt)}` : ""}</p>
                  </div>
                  <a href={`/documents/${d.id}/download`} className="rounded p-2 text-brand-700 hover:bg-brand-50" aria-label={`Download ${d.name}`}><Download className="h-4 w-4" /></a>
                  {canShare && <ActionButton size="sm" variant="ghost" action={setPortalVisibility.bind(null, d.id, !d.isPortalVisible)}>{d.isPortalVisible ? "Unshare" : "Share"}</ActionButton>}
                  {(c.can("documents:delete") || d.uploadedById === c.userId) && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteDocument.bind(null, d.id)} confirm={{ title: `Remove “${d.name}”?`, confirmLabel: "Remove" }}>Remove</ActionButton>}
                </div>
                {older.length > 0 && (
                  <details className="mt-2 pl-8 text-xs text-slate-500"><summary className="cursor-pointer">{older.length} earlier version(s)</summary>
                    {older.map((o) => <p key={o.id} className="mt-1">v{o.version} · {formatDate(o.createdAt)} · <a className="text-brand-700 hover:underline" href={`/documents/${o.id}/download`}>download</a></p>)}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
