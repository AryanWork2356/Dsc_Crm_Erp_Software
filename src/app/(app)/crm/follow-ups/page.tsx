import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/scope";
import { userOptions, SALES_ROLES } from "@/lib/lookups";
import { formatDate, formatINR, startOfDay } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { completeFollowUp, setFollowUp } from "../actions";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage() {
  const c = await requirePerm("leads:view");
  const today = startOfDay();
  const tomorrow = new Date(today.getTime() + 86400000);
  const weekEnd = new Date(today.getTime() + 8 * 86400000);

  const leads = await db.lead.findMany({
    where: { ...leadScope(c), nextFollowUp: { not: null, lt: weekEnd }, stage: { notIn: ["WON", "LOST"] } },
    orderBy: { nextFollowUp: "asc" },
    take: 300,
  });
  const users = await userOptions(c.companyId, SALES_ROLES);
  const owner = new Map(users.map((u) => [u.value, u.label]));
  const canEdit = c.can("leads:edit");

  const groups = [
    { title: "Overdue", tone: "text-red-600", items: leads.filter((l) => l.nextFollowUp! < today) },
    { title: "Today", tone: "text-brand-800", items: leads.filter((l) => l.nextFollowUp! >= today && l.nextFollowUp! < tomorrow) },
    { title: "Next 7 days", tone: "text-slate-700", items: leads.filter((l) => l.nextFollowUp! >= tomorrow) },
  ];

  return (
    <>
      <PageHeader title="Follow-ups" subtitle="Who to call next. Overdue ones are shown first." />
      {leads.length === 0 ? (
        <Card><EmptyState title="Nothing to follow up" hint="Schedule follow-ups from a lead and they will appear here." /></Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <Card key={g.title}>
              <CardHeader><CardTitle className={g.tone}>{g.title} <span className="ml-1 font-normal text-slate-400">({g.items.length})</span></CardTitle></CardHeader>
              {g.items.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">None.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {g.items.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <Link href={`/crm/leads/${l.id}`} className="font-medium text-slate-900 hover:text-brand-700">{l.name}</Link>
                        <p className="text-xs text-slate-500">
                          {formatDate(l.nextFollowUp)} · {l.phone ?? "no phone"}{l.estimatedValue ? ` · ${formatINR(l.estimatedValue)}` : ""}
                          {c.role !== "SALES" && l.assignedToId ? ` · ${owner.get(l.assignedToId) ?? ""}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={l.stage} />
                      {l.phone && <a href={`tel:${l.phone}`}><Button size="sm" variant="secondary">Call</Button></a>}
                      {canEdit && (
                        <>
                          <FormDialog title={`Follow-up done – ${l.name}`} trigger={<Button size="sm">Done</Button>}
                            fields={[{ name: "note", label: "Outcome", type: "textarea" }, { name: "nextFollowUp", label: "Next follow-up (optional)", type: "date" }]}
                            action={completeFollowUp.bind(null, l.id)} />
                          <FormDialog title={`Reschedule – ${l.name}`} trigger={<Button size="sm" variant="ghost">Reschedule</Button>}
                            fields={[{ name: "nextFollowUp", label: "New date", type: "date", required: true }, { name: "note", label: "Note", type: "textarea" }]}
                            action={setFollowUp.bind(null, l.id)} />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
