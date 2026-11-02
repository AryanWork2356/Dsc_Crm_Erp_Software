import Link from "next/link";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { remarkScope, isRemarkStaff } from "@/lib/remarks";
import { TRADES, tradeLabel } from "@/lib/trades";
import { formatDateTime, cn } from "@/lib/utils";
import { PageHeader, EmptyState, TabLinks } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { createRemark } from "./actions";

export const metadata = { title: "Remarks" };

export default async function RemarksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const c = await requireCtx();
  const { tab: t } = await searchParams;
  const tab = t === "sorted" ? "sorted" : "open";
  const staff = isRemarkStaff(c);
  const [rows, openCount, projects] = await Promise.all([
    db.remark.findMany({
      where: { ...remarkScope(c), status: tab === "open" ? "OPEN" : "RESOLVED" },
      include: { project: { select: { code: true, name: true } }, vendor: { select: { name: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" }, take: 100,
    }),
    db.remark.count({ where: { ...remarkScope(c), status: "OPEN" } }),
    db.project.findMany({ where: { ...projectScope(c), status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  const people = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.createdById, r.messages[0]?.userId].filter(Boolean) as string[]))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <>
      <PageHeader
        title="Remarks"
        subtitle={staff ? "Problems the coordinators raise (a vendor not answering or not coming). Reach out, then reply here so the coordinator knows." : "Tried a vendor and they are not answering or not coming? Send a remark. The admins reach out and reply here."}
        actions={projects.length > 0 && (
          <FormDialog title="New remark" trigger={<Button>New remark</Button>} submitLabel="Send"
            fields={[
              { name: "projectId", label: "Project", type: "select", required: true, options: projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })), defaultValue: projects.length === 1 ? projects[0].id : null },
              { name: "trade", label: "Which work / vendor?", type: "select", options: TRADES.map((x) => ({ value: x.key, label: x.label })), hint: "The project's vendor for this work is attached by itself" },
              { name: "body", label: "What happened?", type: "textarea", required: true, full: true, placeholder: "e.g. Painter not answering since morning, 3 calls. Work stopped in the hall." },
            ]}
            action={createRemark} successMessage="Remark sent" />
        )}
      />
      <div className="mb-4"><TabLinks current={tab} tabs={[{ key: "open", label: "Open", href: "/remarks", count: openCount }, { key: "sorted", label: "Sorted", href: "/remarks?tab=sorted" }]} /></div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={tab === "open" ? "No open remarks" : "Nothing sorted yet"} hint={tab === "open" ? "When a vendor is not answering or not coming, send a remark from here." : undefined} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const last = r.messages[0];
              return (
                <li key={r.id}>
                  <Link href={`/remarks/${r.id}`} className="block px-5 py-4 hover:bg-slate-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{r.project ? `${r.project.code} · ${r.project.name}` : "General"}</span>
                      {r.trade && <Badge tone="blue">{tradeLabel(r.trade)}{r.vendor ? ` · ${r.vendor.name}` : ""}</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{r.subject}</p>
                    {last && last.body !== r.subject && <p className={cn("mt-1 truncate text-xs", last.userId === r.createdById ? "text-slate-500" : "font-medium text-emerald-700")}>{people.get(last.userId) ?? "Someone"}: {last.body}</p>}
                    <p className="mt-1 text-xs text-slate-400">by {people.get(r.createdById) ?? "—"} · {formatDateTime(r.updatedAt)}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
