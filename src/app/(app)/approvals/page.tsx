import Link from "next/link";
import type { ApprovalStatus, RoleKey } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { canDecide } from "@/lib/workflow";
import { flatten, listParams } from "@/lib/list";
import { formatDateTime, formatINR, humanize, num } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import { PageHeader, EmptyState, TabLinks } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { approveRequest, rejectRequest } from "./actions";

export const metadata = { title: "Approvals" };

const ROLES = Object.keys(ROLE_LABELS) as RoleKey[];

const LINKS: Record<string, (id: string) => string> = {
  Quotation: (id) => `/sales/quotations/${id}`,
  Boq: (id) => `/sales/boq/${id}`,
  PurchaseRequest: (id) => `/procurement/requests/${id}`,
  PurchaseOrder: (id) => `/procurement/orders/${id}`,
  Invoice: (id) => `/finance/invoices/${id}`,
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("approvals:view");
  const sp = flatten(await searchParams);
  const tab = sp.tab === "mine" ? "mine" : sp.tab === "history" ? "history" : "todo";
  const lp = listParams(sp, "createdAt", "desc", 20);
  const decidable = ROLES.filter((r) => canDecide(c.role, r));
  const canApprove = c.can("approvals:approve");

  const where =
    tab === "todo"
      ? { companyId: c.companyId, status: "PENDING" as ApprovalStatus, requiredRole: { in: decidable }, ...(c.role === "OWNER" ? {} : { requestedById: { not: c.userId } }) }
      : tab === "mine"
        ? { companyId: c.companyId, requestedById: c.userId }
        : { companyId: c.companyId, status: { not: "PENDING" as ApprovalStatus } };

  const [rows, total, todoCount, mineCount] = await Promise.all([
    db.approval.findMany({ where, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
    db.approval.count({ where }),
    db.approval.count({ where: { companyId: c.companyId, status: "PENDING", requiredRole: { in: decidable }, ...(c.role === "OWNER" ? {} : { requestedById: { not: c.userId } }) } }),
    db.approval.count({ where: { companyId: c.companyId, requestedById: c.userId, status: "PENDING" } }),
  ]);
  const people = await db.user.findMany({
    where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById].filter(Boolean) as string[]))] } },
    select: { id: true, name: true },
  });
  const nm = new Map(people.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader title="Approvals" subtitle="Everything waiting for a decision. Amounts decide who has to approve." />
      <TabLinks
        current={tab}
        tabs={[
          { key: "todo", label: "Waiting for me", href: "/approvals", count: todoCount },
          { key: "mine", label: "My requests", href: "/approvals?tab=mine", count: mineCount },
          { key: "history", label: "History", href: "/approvals?tab=history" },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={tab === "todo" ? "Nothing waiting for you" : "No requests"} hint={tab === "todo" ? "You're all caught up." : undefined} />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {rows.map((a) => {
                const href = LINKS[a.entityType]?.(a.entityId);
                const mayDecide = canApprove && a.status === "PENDING" && canDecide(c.role, a.requiredRole) && (a.requestedById !== c.userId || c.role === "OWNER");
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {href ? <Link href={href} className="font-medium text-slate-900 hover:text-brand-700">{a.title}</Link> : <span className="font-medium">{a.title}</span>}
                        <Badge>{humanize(a.type)}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Requested by {nm.get(a.requestedById) ?? "—"} · {formatDateTime(a.createdAt)} · needs {ROLE_LABELS[a.requiredRole]}
                        {a.decidedById && ` · ${a.status === "APPROVED" ? "approved" : "decided"} by ${nm.get(a.decidedById) ?? "—"}`}
                      </p>
                      {a.remarks && <p className="mt-1 text-sm text-slate-600">“{a.remarks}”</p>}
                    </div>
                    {num(a.amount) > 0 && <span className="tabular text-sm font-semibold text-slate-900">{formatINR(a.amount)}</span>}
                    <StatusBadge status={a.status} />
                    {mayDecide && (
                      <div className="flex gap-2">
                        <ActionButton size="sm" variant="success" action={approveRequest.bind(null, a.id, undefined)} successMessage="Approved">Approve</ActionButton>
                        <FormDialog
                          title={`Reject – ${a.title}`}
                          trigger={<Button size="sm" variant="secondary">Reject</Button>}
                          fields={[{ name: "remarks", label: "Reason for rejecting", type: "textarea", required: true }]}
                          action={rejectRequest.bind(null, a.id)}
                          submitLabel="Reject"
                          successMessage="Rejected"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/approvals" />
          </>
        )}
      </Card>
    </>
  );
}
