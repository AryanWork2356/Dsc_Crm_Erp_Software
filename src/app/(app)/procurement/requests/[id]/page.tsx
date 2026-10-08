import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { formatDate, num, humanize } from "@/lib/utils";
import { PageHeader, DetailGrid, Alert } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/forms/action-button";
import { deletePurchaseRequest, submitPurchaseRequest } from "../../actions";

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("purchase_requests:view");
  const pr = await db.purchaseRequest.findFirst({ where: { id, companyId: c.companyId }, include: { items: true, project: { select: { id: true, code: true, name: true } } } });
  if (!pr) notFound();
  if (!["OWNER", "MANAGEMENT", "ADMIN", "PROCUREMENT", "ACCOUNTS"].includes(c.role) && pr.requestedById !== c.userId) {
    const mine = pr.projectId ? await db.project.findFirst({ where: { id: pr.projectId, ...projectScope(c) }, select: { id: true } }) : null;
    if (!mine) redirect("/forbidden");
  }
  const [requester, pending, pos] = await Promise.all([
    db.user.findUnique({ where: { id: pr.requestedById }, select: { name: true } }),
    pr.status === "PENDING_APPROVAL" ? db.approval.findFirst({ where: { companyId: c.companyId, entityType: "PurchaseRequest", entityId: id, status: "PENDING" } }) : null,
    db.purchaseOrder.findMany({ where: { requestId: id }, select: { id: true, number: true, status: true } }),
  ]);
  const own = pr.requestedById === c.userId;
  const editable = ["DRAFT", "REJECTED"].includes(pr.status) && (own || c.can("purchase_requests:approve"));

  return (
    <>
      <PageHeader
        back={{ href: "/procurement/requests", label: "Purchase requests" }}
        title={pr.number}
        subtitle={`Requested by ${requester?.name ?? "—"} on ${formatDate(pr.createdAt)}`}
        actions={
          <>
            <StatusBadge status={pr.status} />
            {editable && <Link href={`/procurement/requests/${id}/edit`}><Button variant="secondary" size="sm">Edit</Button></Link>}
            {editable && <ActionButton size="sm" action={submitPurchaseRequest.bind(null, id)}>Submit for approval</ActionButton>}
            {editable && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={async () => { "use server"; const r = await deletePurchaseRequest(id); if (r.ok) redirect("/procurement/requests"); return r; }} confirm={{ title: "Delete this request?", confirmLabel: "Delete" }}>Delete</ActionButton>}
            {pr.status === "APPROVED" && c.can("purchase_orders:create") && <Link href={`/procurement/orders/new?requestId=${id}`}><Button size="sm">Create purchase order</Button></Link>}
          </>
        }
      />
      {pending && <div className="mb-4"><Alert tone="warn">Waiting for approval from <b>{humanize(pending.requiredRole)}</b>. <Link href="/approvals" className="font-medium underline">Open approvals</Link></Alert></div>}
      {pr.status === "REJECTED" && <div className="mb-4"><Alert tone="bad">Rejected. Edit the request and submit it again.</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Items ({pr.items.length})</CardTitle></CardHeader>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">#</th><th className="px-4 py-2 text-left">Item</th><th className="px-4 py-2 text-left">Unit</th><th className="px-4 py-2 text-right">Quantity</th></tr></thead>
            <tbody>{pr.items.map((i, n) => <tr key={i.id} className="border-t border-slate-100"><td className="px-4 py-2.5 text-slate-400">{n + 1}</td><td className="px-4 py-2.5 text-slate-900">{i.description}</td><td className="px-4 py-2.5">{i.unit}</td><td className="tabular px-4 py-2.5 text-right">{num(i.quantity)}</td></tr>)}</tbody>
          </table>
        </Card>
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardBody>
            <DetailGrid items={[
              { label: "Project", value: pr.project ? <Link className="text-brand-700 hover:underline" href={`/projects/${pr.project.id}`}>{pr.project.code} · {pr.project.name}</Link> : "General stock" },
              { label: "Needed by", value: formatDate(pr.requiredDate) }, { label: "Priority", value: <StatusBadge status={pr.priority} /> },
              { label: "Reason", value: pr.reason },
            ]} />
          </CardBody></Card>
          {pos.length > 0 && <Card><CardHeader><CardTitle>Purchase orders</CardTitle></CardHeader><CardBody className="space-y-2 py-3">{pos.map((p) => <div key={p.id} className="flex items-center justify-between text-sm"><Link className="font-medium text-brand-700 hover:underline" href={`/procurement/orders/${p.id}`}>{p.number}</Link><StatusBadge status={p.status} /></div>)}</CardBody></Card>}
        </div>
      </div>
    </>
  );
}
