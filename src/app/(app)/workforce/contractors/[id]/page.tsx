import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectOptions } from "@/lib/lookups";
import { PAYMENT_METHOD_OPTS } from "@/lib/enums";
import { formatDate, formatINR, humanize, num, toDateInput } from "@/lib/utils";
import { PageHeader, StatCard, DetailGrid, EmptyState } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { createWorkOrder, deleteContractor, recordContractorPayment, setWorkOrderStatus, updateContractor } from "../../actions";
import { contractorFields } from "../contractor-fields";

export default async function ContractorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("contractors:view");
  const x = await db.contractor.findFirst({
    where: { id, companyId: c.companyId, deletedAt: null },
    include: { workers: { where: { deletedAt: null }, orderBy: { name: "asc" } }, workOrders: { orderBy: { createdAt: "desc" }, include: { payments: { select: { amount: true } } } }, payments: { orderBy: { date: "desc" }, take: 20 } },
  });
  if (!x) notFound();
  const money = c.can("payments:view");
  const projects = await projectOptions(c.companyId);
  const pn = new Map(projects.map((p) => [p.value, p.label]));
  const value = x.workOrders.filter((w) => w.status !== "CANCELLED").reduce((s, w) => s + num(w.amount), 0);
  const paidAll = (await db.contractorPayment.aggregate({ where: { contractorId: id }, _sum: { amount: true } }))._sum.amount;
  const labourDays = await db.attendance.groupBy({ by: ["status"], where: { companyId: c.companyId, workerId: { in: x.workers.map((w) => w.id) } }, _count: true });
  const days = labourDays.filter((d) => d.status !== "ABSENT" && d.status !== "LEAVE").reduce((s, d) => s + d._count, 0);
  const openOrders = x.workOrders.filter((w) => w.status === "OPEN");

  return (
    <>
      <PageHeader
        back={{ href: "/workforce/contractors", label: "All contractors" }} title={x.name} subtitle={[x.contactPerson, x.phone].filter(Boolean).join(" · ")}
        actions={<>
          {c.can("contractors:edit") && <FormDialog title="Edit contractor" wide trigger={<Button variant="secondary">Edit</Button>} fields={contractorFields(x as unknown as Record<string, unknown>)} action={updateContractor.bind(null, id)} />}
          {c.can("contractors:edit") && <FormDialog title="New work order" wide trigger={<Button>New work order</Button>} fields={[{ name: "title", label: "Work", required: true, full: true, placeholder: "e.g. Tiling – 3rd floor" }, { name: "projectId", label: "Project", type: "select", options: projects }, { name: "amount", label: "Agreed value (₹)", type: "number" }, { name: "startDate", label: "Start", type: "date" }, { name: "endDate", label: "Finish by", type: "date" }, { name: "rateNote", label: "Rates agreed", placeholder: "e.g. ₹45/sq ft" }, { name: "scope", label: "Scope of work", type: "textarea" }]} action={createWorkOrder.bind(null, id)} />}
        </>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Workers" value={x.workers.length} sub={`${days} worker-days recorded`} />
        <StatCard label="Open work orders" value={openOrders.length} />
        {money && <StatCard label="Work value" value={formatINR(value)} />}
        {money && <StatCard label="Balance to pay" value={formatINR(Math.max(0, value - num(paidAll)))} tone={value - num(paidAll) > 0 ? "warn" : "default"} sub={`Paid ${formatINR(paidAll)}`} />}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Work orders</CardTitle></CardHeader>
            {x.workOrders.length === 0 ? <EmptyState title="No work orders" /> : (
              <ul className="divide-y divide-slate-100">
                {x.workOrders.map((w) => {
                  const paid = w.payments.reduce((s, p) => s + num(p.amount), 0);
                  return (
                    <li key={w.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{w.number} · {w.title}</p><p className="text-xs text-slate-500">{w.projectId ? pn.get(w.projectId) : "No project"}{w.rateNote ? ` · ${w.rateNote}` : ""}</p></div>
                      {money && <span className="tabular text-sm">{formatINR(paid)} / {formatINR(w.amount)}</span>}
                      <Badge tone={w.status === "COMPLETED" ? "green" : w.status === "CANCELLED" ? "red" : "blue"}>{humanize(w.status)}</Badge>
                      {c.can("contractors:edit") && w.status === "OPEN" && <ActionButton size="sm" variant="secondary" action={setWorkOrderStatus.bind(null, w.id, "COMPLETED")}>Mark complete</ActionButton>}
                      {c.can("payments:create") && w.status !== "CANCELLED" && <FormDialog title={`Pay – ${w.number}`} trigger={<Button size="sm" variant="ghost">Record payment</Button>} fields={[{ name: "workOrderId", label: "Work order", type: "hidden", defaultValue: w.id }, { name: "amount", label: "Amount (₹)", type: "number", required: true }, { name: "date", label: "Date", type: "date", required: true, defaultValue: toDateInput(new Date()) }, { name: "method", label: "Method", type: "select", options: PAYMENT_METHOD_OPTS, defaultValue: "BANK_TRANSFER" }, { name: "reference", label: "Reference / UTR" }]} action={recordContractorPayment.bind(null, id)} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {money && (
            <Card>
              <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
              {x.payments.length === 0 ? <EmptyState title="No payments yet" /> : (
                <ul className="divide-y divide-slate-100">{x.payments.map((p) => <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm"><span>{formatDate(p.date)}</span><span className="text-slate-500">{humanize(p.method)}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular ml-auto font-medium">{formatINR(p.amount)}</span></li>)}</ul>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardBody><DetailGrid items={[{ label: "Email", value: x.email }, { label: "GSTIN", value: x.gstin }, { label: "Rating", value: x.rating ? "★".repeat(x.rating) : null }]} />{x.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{x.notes}</p>}</CardBody></Card>
          <Card><CardHeader><CardTitle>Workers ({x.workers.length})</CardTitle></CardHeader><CardBody className="space-y-1.5 py-3 text-sm">{x.workers.length === 0 && <p className="text-slate-500">None assigned.</p>}{x.workers.map((w) => <div key={w.id} className="flex justify-between"><span>{w.name}</span><span className="text-slate-500">{humanize(w.trade)}</span></div>)}</CardBody></Card>
          {c.can("contractors:delete") && <ActionButton variant="ghost" className="text-red-600 hover:bg-red-50" action={async () => { "use server"; const r = await deleteContractor(id); if (r.ok) redirect("/workforce/contractors"); return r; }} confirm={{ title: "Delete this contractor?", confirmLabel: "Delete" }}>Delete contractor</ActionButton>}
        </div>
      </div>
    </>
  );
}
