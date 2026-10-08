import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatDate, formatINR, num } from "@/lib/utils";
import { PageHeader, DetailGrid, EmptyState } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { saveSalaryStructure, setEmployeeStatus, updateEmployee } from "../../actions";
import { employeeFields } from "../employee-fields";
import { DocumentsPanel } from "@/components/documents/documents-panel";

export default async function EmployeeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("employees:view");
  const e = await db.employee.findFirst({
    where: { id, companyId: c.companyId, deletedAt: null },
    include: { user: { select: { role: true, email: true, lastLoginAt: true } }, salaryStructure: true, leaves: { orderBy: { fromDate: "desc" }, take: 8 }, payslips: { orderBy: [{ year: "desc" }, { month: "desc" }], take: 6 } },
  });
  if (!e) notFound();
  const salary = c.can("salary:view");
  const people = await db.employee.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true } });
  const manager = people.find((p) => p.id === e.managerId)?.name;
  const s = e.salaryStructure;
  const gross = s ? num(s.basic) + num(s.hra) + num(s.allowances) : 0;

  return (
    <>
      <PageHeader
        back={{ href: "/hr/employees", label: "All employees" }} title={e.name} subtitle={`${e.code} · ${e.designation ?? "—"}${e.department ? ` · ${e.department}` : ""}`}
        actions={<>
          <StatusBadge status={e.status} />
          {c.can("employees:edit") && <FormDialog title="Edit employee" wide trigger={<Button variant="secondary">Edit</Button>} fields={employeeFields(people.map((p) => ({ value: p.id, label: p.name })), e as unknown as Record<string, unknown>)} action={updateEmployee.bind(null, id)} />}
          {c.can("employees:edit") && e.status !== "EXITED" && <ActionButton variant="ghost" className="text-red-600 hover:bg-red-50" action={setEmployeeStatus.bind(null, id, "EXITED")} confirm={{ title: `Mark ${e.name} as exited?`, body: "Their login is disabled immediately. Records are kept.", confirmLabel: "Mark exited" }}>Mark exited</ActionButton>}
          {c.can("employees:edit") && e.status === "EXITED" && <ActionButton variant="secondary" action={setEmployeeStatus.bind(null, id, "ACTIVE")}>Reinstate</ActionButton>}
        </>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card><CardHeader><CardTitle>Profile</CardTitle></CardHeader><CardBody>
            <DetailGrid items={[{ label: "Email", value: e.email }, { label: "Phone", value: e.phone }, { label: "Joined", value: formatDate(e.joiningDate) }, { label: "Reports to", value: manager }, { label: "Location", value: e.workLocation }, { label: "Emergency contact", value: e.emergencyContact }, { label: "System role", value: e.user ? ROLE_LABELS[e.user.role] : "No login" }, { label: "Last sign-in", value: e.user?.lastLoginAt ? formatDate(e.user.lastLoginAt) : null }]} />
          </CardBody></Card>
          <Card>
            <CardHeader><CardTitle>Leave</CardTitle></CardHeader>
            {e.leaves.length === 0 ? <EmptyState title="No leave taken" /> : <ul className="divide-y divide-slate-100">{e.leaves.map((l) => <li key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm"><span>{formatDate(l.fromDate)} – {formatDate(l.toDate)}</span><span className="text-slate-500">{num(l.days)} day(s){l.paid ? "" : " · unpaid"}</span><span className="ml-auto"><StatusBadge status={l.status} /></span></li>)}</ul>}
          </Card>
        </div>
        {salary && (
          <div className="space-y-5">
            <DocumentsPanel c={c} entityType="EMPLOYEE" entityId={id} title="Employee documents" />
            <Card>
              <CardHeader><CardTitle>Salary structure</CardTitle>{c.can("payroll:edit") && <FormDialog title={`Salary – ${e.name}`} trigger={<Button size="sm" variant="secondary">{s ? "Change" : "Set up"}</Button>} fields={[{ name: "basic", label: "Basic (₹/month)", type: "number", required: true, defaultValue: s ? num(s.basic) : null }, { name: "hra", label: "HRA", type: "number", defaultValue: s ? num(s.hra) : 0 }, { name: "allowances", label: "Other allowances", type: "number", defaultValue: s ? num(s.allowances) : 0 }, { name: "deductions", label: "Fixed deductions", type: "number", defaultValue: s ? num(s.deductions) : 0 }]} action={saveSalaryStructure.bind(null, id)} />}</CardHeader>
              <CardBody>{s ? <DetailGrid items={[{ label: "Basic", value: formatINR(s.basic) }, { label: "HRA", value: formatINR(s.hra) }, { label: "Allowances", value: formatINR(s.allowances) }, { label: "Deductions", value: formatINR(s.deductions) }, { label: "Gross", value: <b>{formatINR(gross)}</b> }]} /> : <p className="text-sm text-slate-500">Not set up yet.</p>}</CardBody>
            </Card>
            <Card>
              <CardHeader><CardTitle>Recent payslips</CardTitle></CardHeader>
              <CardBody className="space-y-2 py-3">
                {e.payslips.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
                {e.payslips.map((p) => <div key={p.id} className="flex items-center justify-between text-sm"><span>{String(p.month).padStart(2, "0")}/{p.year}</span><span className="tabular font-medium">{formatINR(p.netSalary)}</span><a href={`/hr/payslips/${p.id}/pdf`} target="_blank" rel="noreferrer" className="text-brand-700"><FileDown className="h-4 w-4" /></a></div>)}
                <Link href="/hr/payroll" className="block pt-1 text-sm font-medium text-brand-700 hover:underline">Open payroll →</Link>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
