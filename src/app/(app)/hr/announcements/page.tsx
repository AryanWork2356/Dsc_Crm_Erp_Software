import { Pin } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { createAnnouncement, deleteAnnouncement } from "../actions";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const c = await requireCtx();
  const rows = await db.announcement.findMany({ where: { companyId: c.companyId, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 50 });
  const manage = c.can("employees:create");
  return (
    <>
      <PageHeader title="Announcements" subtitle="News and notices for the whole team." actions={manage && <FormDialog title="New announcement" wide trigger={<Button>Post announcement</Button>} fields={[{ name: "title", label: "Title", required: true, full: true }, { name: "body", label: "Message", type: "textarea", required: true }, { name: "pinned", label: "Pin to the top", type: "checkbox" }, { name: "expiresAt", label: "Hide after", type: "date" }]} action={createAnnouncement} successMessage="Announcement posted" />} />
      {rows.length === 0 ? <Card><EmptyState title="No announcements" /></Card> : (
        <div className="space-y-4">
          {rows.map((a) => (
            <Card key={a.id}><div className="p-5">
              <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 font-semibold text-slate-900">{a.pinned && <Pin className="h-4 w-4 text-accent" />}{a.title}</h2><p className="mt-0.5 text-xs text-slate-500">{formatDateTime(a.createdAt)}</p></div>
                {c.can("employees:edit") && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteAnnouncement.bind(null, a.id)} confirm={{ title: "Remove this announcement?", confirmLabel: "Remove" }}>Remove</ActionButton>}</div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{a.body}</p>
            </div></Card>
          ))}
        </div>
      )}
    </>
  );
}
