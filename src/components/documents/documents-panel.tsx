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
import { canShareDownloads, DOWNLOADS_FOLDER, isDirector } from "@/lib/doc-access";

const SHAREABLE = ["PROJECT", "QUOTATION", "INVOICE", "BOQ", "PO", "TICKET"];

/**
 * Files attached to one record (project, client, vendor…). Upload, download, version history, delete.
 * A project has two lists (DSC rule, see lib/doc-access): `private` = the project's documents, which anyone on the project may upload
 * but only directors see; `downloads` = Downloadables, which directors and admins share with the whole project team (drawings…).
 */
export async function DocumentsPanel({ c, entityType, entityId, title = "Documents", view = "all" }: { c: Ctx; entityType: string; entityId: string; title?: string; view?: "all" | "private" | "downloads" }) {
  const downloads = view === "downloads";
  const hidden = view === "private" && !isDirector(c); // they may upload, but not see the list
  const folderWhere = downloads ? { folder: DOWNLOADS_FOLDER } : view === "private" ? { OR: [{ folder: null }, { folder: { not: DOWNLOADS_FOLDER } }] } : {};
  const docs = hidden ? [] : await db.document.findMany({ where: { companyId: c.companyId, entityType, entityId, deletedAt: null, ...folderWhere }, orderBy: [{ name: "asc" }, { version: "desc" }] });
  const canUpload = downloads ? c.can("documents:create") && canShareDownloads(c) : c.can("documents:create");
  const latest = docs.filter((d, i) => docs.findIndex((x) => x.name.toLowerCase() === d.name.toLowerCase()) === i);
  const users = await db.user.findMany({ where: { id: { in: [...new Set(docs.map((d) => d.uploadedById).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const who = new Map(users.map((u) => [u.id, u.name]));
  const canShare = c.can("documents:edit") && SHAREABLE.includes(entityType);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}{!hidden && ` (${latest.length})`}</CardTitle>
        {canUpload && (
          <FormDialog
            title={downloads ? "Share a file with the site team" : "Upload a file"} description={downloads ? "Everyone on this project can open and download it (drawings, approved designs, schedules…). PDF, images, Excel, Word – up to 10 MB." : hidden ? "Only directors can open project documents. You can upload here; you will not see the list." : "PDF, images, Excel, Word, CSV or text – up to 10 MB. Uploading a file with the same name saves a new version."} wide
            trigger={<Button size="sm">Upload</Button>}
            fields={[
              { name: "entityType", label: "Type", type: "hidden", defaultValue: entityType }, { name: "entityId", label: "Id", type: "hidden", defaultValue: entityId },
              { name: "file", label: "File", type: "file", required: true, full: true },
              { name: "type", label: "Document type", type: "select", options: DOCUMENT_TYPE_OPTS, defaultValue: downloads ? "DRAWING" : "OTHER" },
              { name: "name", label: "Name (optional)", hint: "Defaults to the file name" },
              ...(downloads ? [{ name: "folder", label: "Folder", type: "hidden" as const, defaultValue: DOWNLOADS_FOLDER }] : [{ name: "folder", label: "Folder", placeholder: "e.g. Drawings / Rev 2" }]), { name: "tags", label: "Tags", placeholder: "comma separated" },
              { name: "expiresAt", label: "Expires on (optional)", type: "date", hint: "You'll be reminded before it expires" },
              ...(canShare ? [{ name: "isPortalVisible", label: "Share with client / vendor portal", type: "checkbox" as const }] : []),
            ]}
            action={uploadDocument} submitLabel="Upload"
          />
        )}
      </CardHeader>
      {hidden ? <EmptyState title="Only directors can open project documents" hint="Upload anything the directors should have (bills, photos, papers from the client). Files shared with you are in Downloadables." /> : latest.length === 0 ? <EmptyState title="No files yet" hint={downloads ? "Directors put drawings and files for the site here." : "Upload drawings, photos, contracts or bills."} /> : (
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
