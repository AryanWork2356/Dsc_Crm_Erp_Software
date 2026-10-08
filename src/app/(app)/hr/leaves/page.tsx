import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { formatDate, num } from "@/lib/utils";
import { PageHeader, EmptyState, TabLinks } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { applyLeave, cancelLeave } from "../actions";
import Link from "next/link";

export const metadata = { title: "Leaves" };

export default async function LeavesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("leaves:view");
  const sp = flatten(await searchParams);
  const manage = c.can("leaves:manage");
  const tab = sp.tab === "all" && manage ? "all" : "mine";
  const lp = listParams(sp, "fromDate", "desc", 20);
  const me = await db.employee.findFirst({ where: { companyId: c.companyId, userId: c.userId, deletedAt: null } });
  const where = { companyId: c.companyId, ...(tab === "mine" ? { employeeId: me?.id ?? "none" } : {}), ...(sp.status ? { status: sp.status as never } : {}) };
  const [rows, total, pending] = await Promise.all([
    db.leave.findMany({ where, include: { employee: { select: { name: true, userId: true } } }, orderBy: { fromDate: "desc" }, skip: lp.skip, take: lp.take }),
    db.leave.count({ where }),
    manage ? db.leave.count({ where: { companyId: c.companyId, status: "PENDING" } }) : 0,
  ]);
  const today = new Date(new Date().toISOString().slice(0, 10));

  return (
    <>
      <PageHeader
        title="Leave"
        subtitle="Apply for leave and track requests. HR approves."
        actions={c.can("leaves:create") && me && <FormDialog title="Apply for leave" trigger={<Button>Apply for leave</Button>} fields={[{ name: "fromDate", label: "First day", type: "date", required: true }, { name: "toDate", label: "Last day", type: "date", required: true }, { name: "paid", label: "Paid leave", type: "checkbox", defaultValue: true, hint: "Untick for unpaid leave" }, { name: "reason", label: "Reason", type: "textarea" }]} action={applyLeave} submitLabel="Send request" />}
      />
      <TabLinks current={tab} tabs={[{ key: "mine", label: "My leave", href: "/hr/leaves" }, ...(manage ? [{ key: "all", label: "Everyone", href: "/hr/leaves?tab=all", count: pending }] : [])]} />
      <Card>
        {rows.length === 0 ? <EmptyState title="No leave records" /> : (
          <>
            <ul className="divide-y divide-slate-100">
              {rows.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    {tab === "all" && <p className="font-medium text-slate-900">{l.employee.name}</p>}
                    <p className={tab === "all" ? "text-sm text-slate-600" : "font-medium text-slate-900"}>{formatDate(l.fromDate)} – {formatDate(l.toDate)} · {num(l.days)} day(s)</p>
                    {l.reason && <p className="text-xs text-slate-500">{l.reason}</p>}
                    {l.decisionNote && <p className="text-xs text-red-600">HR: {l.decisionNote}</p>}
                  </div>
                  {!l.paid && <Badge tone="amber">Unpaid</Badge>}
                  <StatusBadge status={l.status} />
                  {l.status === "PENDING" && manage && <Link href="/approvals" className="text-sm font-medium text-brand-700 hover:underline">Decide</Link>}
                  {(l.employee.userId === c.userId || manage) && l.status !== "REJECTED" && (l.status === "PENDING" || l.fromDate >= today) && (
                    <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={cancelLeave.bind(null, l.id)} confirm={{ title: "Cancel this leave?", confirmLabel: "Cancel leave" }}>Cancel</ActionButton>
                  )}
                </li>
              ))}
            </ul>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/hr/leaves" />
          </>
        )}
      </Card>
    </>
  );
}
