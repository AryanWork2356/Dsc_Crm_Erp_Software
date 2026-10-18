import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { balanceOf } from "@/lib/advances";
import { formatDate, formatINR, num, toDateInput } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard, TabLinks } from "@/components/ui/page";
import { flatten } from "@/lib/list";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { giveAdvance, writeOffAdvance } from "../actions";

export const metadata = { title: "Employee advances" };

export default async function AdvancesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("payroll:view");
  if (!c.can("salary:view")) return <EmptyState title="Salary information is restricted" hint="Ask HR or Management." />;
  const sp = flatten(await searchParams);
  const tab = sp.tab === "all" ? "all" : "open";
  const [rows, employees] = await Promise.all([
    db.employeeAdvance.findMany({ where: { companyId: c.companyId, ...(tab === "open" ? { status: "OPEN" } : {}) }, include: { employee: { select: { name: true, code: true } }, recoveries: true }, orderBy: { givenOn: "desc" }, take: 100 }),
    db.employee.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { not: "EXITED" } }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
  ]);
  const outstanding = rows.filter((r) => r.status === "OPEN").reduce((s, r) => s + balanceOf(r), 0);
  const canWriteOff = ["OWNER", "MANAGEMENT"].includes(c.role);

  return (
    <div>
      <PageHeader
        title="Employee advances"
        subtitle="Money given in advance is recovered from salary in monthly instalments. Payroll does it automatically."
        actions={c.can("payroll:create") && (
          <FormDialog title="Give an advance" wide trigger={<Button>Give advance</Button>}
            fields={[
              { name: "employeeId", label: "Employee", type: "select", required: true, options: employees.map((e) => ({ value: e.id, label: `${e.name} (${e.code})` })) },
              { name: "amount", label: "Advance amount (₹)", type: "number", required: true },
              { name: "monthlyRecovery", label: "Recovered each month (₹)", type: "number", required: true, hint: "Deducted from the salary in every payroll run until repaid" },
              { name: "givenOn", label: "Given on", type: "date", defaultValue: toDateInput(new Date()) },
              { name: "reason", label: "Reason", type: "textarea", full: true },
            ]} action={giveAdvance} submitLabel="Record advance" />
        )}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="Still to recover" value={formatINR(outstanding)} tone={outstanding ? "warn" : "good"} sub={`${rows.filter((r) => r.status === "OPEN").length} open advance(s)`} />
      </div>
      <div className="mb-4"><TabLinks current={tab} tabs={[{ key: "open", label: "Open", href: "/hr/advances" }, { key: "all", label: "All", href: "/hr/advances?tab=all" }]} /></div>
      {rows.length === 0 ? <EmptyState title="No advances" hint="When an employee takes an advance, record it here so payroll recovers it." /> : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {rows.map((a) => {
              const left = balanceOf(a);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{a.employee.name} <span className="text-xs text-slate-500">{a.employee.code}</span></p>
                    <p className="text-xs text-slate-500">{formatINR(a.amount)} given {formatDate(a.givenOn)} · {formatINR(a.monthlyRecovery)} a month{a.reason ? ` · ${a.reason}` : ""}</p>
                  </div>
                  <div className="text-right"><p className="tabular text-sm font-semibold text-slate-900">{formatINR(left)} left</p><p className="text-xs text-slate-500">{formatINR(num(a.amount) - left)} recovered</p></div>
                  <Badge tone={a.status === "OPEN" ? "amber" : a.status === "CLEARED" ? "green" : "slate"}>{a.status === "OPEN" ? "Recovering" : a.status === "CLEARED" ? "Repaid" : "Written off"}</Badge>
                  {canWriteOff && a.status === "OPEN" && <FormDialog title="Write off this advance" description="Recovery stops. This is recorded in the audit log." trigger={<Button size="sm" variant="ghost">Write off</Button>} fields={[{ name: "note", label: "Reason", type: "textarea", required: true, full: true }]} action={writeOffAdvance.bind(null, a.id)} submitLabel="Write off" />}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
