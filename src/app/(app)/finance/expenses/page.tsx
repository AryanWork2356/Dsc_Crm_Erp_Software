import type { ExpenseCategory, Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten, listParams } from "@/lib/list";
import { EXPENSE_CATEGORY_OPTS } from "@/lib/enums";
import { formatDate, formatINR, humanize, toDateInput } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { createExpense, deleteExpense } from "../actions";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("expenses:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "date", "desc", 25);
  const seeAll = c.can("finance:view") || ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role);
  const projects = await db.project.findMany({ where: projectScope(c), select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" } });
  const where: Prisma.ExpenseWhereInput = {
    companyId: c.companyId,
    ...(seeAll ? {} : { OR: [{ createdById: c.userId }, { projectId: { in: projects.map((p) => p.id) } }] }),
    ...(sp.category ? { category: sp.category as ExpenseCategory } : {}),
    ...(sp.project ? { projectId: sp.project } : {}),
    ...(sp.status === "pending" ? { approved: false, rejectedAt: null } : sp.status === "rejected" ? { rejectedAt: { not: null } } : sp.status === "approved" ? { approved: true } : {}),
    ...(lp.q ? { OR: [{ description: { contains: lp.q, mode: "insensitive" } }, { reference: { contains: lp.q, mode: "insensitive" } }] } : {}),
  };
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [rows, total, month, pending] = await Promise.all([
    db.expense.findMany({ where, include: { project: { select: { code: true } } }, orderBy: { date: "desc" }, skip: lp.skip, take: lp.take }),
    db.expense.count({ where }),
    db.expense.aggregate({ where: { ...where, approved: true, date: { gte: monthStart } }, _sum: { amount: true } }),
    db.expense.count({ where: { ...where, approved: false, rejectedAt: null } }),
  ]);
  return (
    <>
      <PageHeader title="Expenses" subtitle="Site, travel, petty cash and other spending. Larger amounts need approval." actions={c.can("expenses:create") && (
        <FormDialog title="Log an expense" wide trigger={<Button>Add expense</Button>} fields={[
          { name: "description", label: "What was it for?", required: true, full: true },
          { name: "amount", label: "Amount (₹)", type: "number", required: true },
          { name: "date", label: "Date", type: "date", required: true, defaultValue: toDateInput(new Date()) },
          { name: "category", label: "Category", type: "select", required: true, options: EXPENSE_CATEGORY_OPTS, defaultValue: "MISC" },
          { name: "projectId", label: "Charge to project", type: "select", options: projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })), hint: "Counts towards that project's cost once approved" },
          { name: "paidBy", label: "Paid by", placeholder: "Person / petty cash / card" },
          { name: "reference", label: "Bill / receipt no." },
        ]} action={createExpense} submitLabel="Save" />
      )} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3"><StatCard label="Approved this month" value={formatINR(month._sum.amount)} /><StatCard label="Waiting for approval" value={pending} tone={pending ? "warn" : "default"} href="/finance/expenses?status=pending" /></div>
      <Card>
        <ListFilters placeholder="Search description or reference…" filters={[{ key: "category", label: "Category", options: EXPENSE_CATEGORY_OPTS }, { key: "project", label: "Project", options: projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })) }, { key: "status", label: "Status", options: [{ value: "approved", label: "Approved" }, { value: "pending", label: "Pending" }, { value: "rejected", label: "Rejected" }] }]} />
        {rows.length === 0 ? <EmptyState title="No expenses found" /> : (
          <>
            <Table>
              <THead><tr><Th>Date</Th><Th>Description</Th><Th>Category</Th><Th>Project</Th><Th>Status</Th><Th right>Amount</Th>{c.can("expenses:delete") && <Th />}</tr></THead>
              <tbody>
                {rows.map((e) => (
                  <Tr key={e.id}>
                    <Td>{formatDate(e.date)}</Td><Td><p className="font-medium text-slate-900">{e.description}</p>{e.paidBy && <p className="text-xs text-slate-500">Paid by {e.paidBy}{e.reference ? ` · ${e.reference}` : ""}</p>}</Td>
                    <Td>{humanize(e.category)}</Td><Td>{e.project?.code ?? "—"}</Td>
                    <Td>{e.approved ? <Badge tone="green">Approved</Badge> : e.rejectedAt ? <Badge tone="red">Rejected</Badge> : <Badge tone="amber">Pending</Badge>}</Td>
                    <Td right className="font-semibold text-slate-900">{formatINR(e.amount, true)}</Td>
                    {c.can("expenses:delete") && <Td right><ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteExpense.bind(null, e.id)} confirm={{ title: "Delete this expense?", confirmLabel: "Delete" }}>Delete</ActionButton></Td>}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/finance/expenses" />
          </>
        )}
      </Card>
    </>
  );
}
