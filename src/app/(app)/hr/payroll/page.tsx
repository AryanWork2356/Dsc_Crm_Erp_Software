import { FileDown } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { readPayrollConfig } from "@/lib/payroll";
import { flatten } from "@/lib/list";
import { formatINR, num } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard, Alert } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { adjustPayslip, runPayroll, savePayrollConfig } from "../actions";

export const metadata = { title: "Payroll" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("payroll:view");
  if (!c.can("salary:view")) return <EmptyState title="Payroll is restricted" hint="Only HR, Management and the Owner can see salaries." />;
  const sp = flatten(await searchParams);
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;
  const [slips, settings, withStructure, total] = await Promise.all([
    db.payslip.findMany({ where: { companyId: c.companyId, month, year }, include: { employee: { select: { name: true, code: true, designation: true } } }, orderBy: { employee: { name: "asc" } } }),
    db.companySettings.findUnique({ where: { companyId: c.companyId } }),
    db.employee.count({ where: { companyId: c.companyId, deletedAt: null, status: { not: "EXITED" }, salaryStructure: { isNot: null } } }),
    db.payslip.aggregate({ where: { companyId: c.companyId, month, year }, _sum: { netSalary: true } }),
  ]);
  const cfg = readPayrollConfig(settings?.payrollConfig);
  const canRun = c.can("payroll:create");

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle={`${MONTHS[month - 1]} ${year}`}
        actions={<>
          {c.can("payroll:edit") && <FormDialog title="Payroll rules" description="These rules drive every payslip. Statutory items (PF etc.) are off until you set them." wide trigger={<Button variant="secondary">Payroll rules</Button>} fields={[
            { name: "workingDays", label: "Working days per month", type: "number", step: "1", defaultValue: cfg.workingDays, required: true },
            { name: "hoursPerDay", label: "Hours per day", type: "number", defaultValue: cfg.hoursPerDay },
            { name: "paidLeavesPerMonth", label: "Paid leave days allowed per month", type: "number", defaultValue: cfg.paidLeavesPerMonth },
            { name: "overtimeMultiplier", label: "Overtime rate (× hourly)", type: "number", defaultValue: cfg.overtimeMultiplier },
            { name: "pfPercent", label: "Provident fund (% of basic)", type: "number", defaultValue: cfg.pfPercent, hint: "0 = not deducted" },
            { name: "fixedDeduction", label: "Other fixed monthly deduction (₹)", type: "number", defaultValue: cfg.fixedDeduction, hint: "e.g. professional tax. 0 = none" },
            { name: "useAttendance", label: "Deduct pay for absences found in attendance", type: "checkbox", defaultValue: cfg.useAttendance },
          ]} action={savePayrollConfig} />}
          {canRun && <FormDialog title="Run payroll" description="Creates or refreshes payslips for everyone with a salary structure. Incentives/bonus you added are kept." trigger={<Button>Run payroll</Button>} fields={[{ name: "month", label: "Month", type: "select", required: true, defaultValue: month, options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) }, { name: "year", label: "Year", type: "number", step: "1", required: true, defaultValue: year }]} action={runPayroll} submitLabel="Run" />}
        </>}
      />
      <form method="get" className="mb-5 flex items-end gap-3">
        <label className="space-y-1 text-xs font-medium text-slate-600">Month<select name="month" defaultValue={month} className="block h-10 rounded-lg border border-slate-300 px-3 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label className="space-y-1 text-xs font-medium text-slate-600">Year<input name="year" type="number" defaultValue={year} className="block h-10 w-24 rounded-lg border border-slate-300 px-3 text-sm" /></label>
        <button className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium shadow-sm hover:bg-slate-50">Show</button>
      </form>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Net payable" value={formatINR(total._sum.netSalary)} />
        <StatCard label="Payslips" value={slips.length} sub={`${withStructure} employees have a salary structure`} />
        <StatCard label="Working days" value={cfg.workingDays} sub={cfg.useAttendance ? "Attendance-based" : "Leave-based only"} />
      </div>
      {slips.length === 0 && withStructure > 0 && <div className="mb-4"><Alert tone="info">No payslips for this month yet. Click <b>Run payroll</b>.</Alert></div>}
      <Card>
        <CardHeader><CardTitle>Payslips</CardTitle></CardHeader>
        {slips.length === 0 ? <EmptyState title="Nothing generated" hint="Set up salary structures on employee profiles first." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Employee</th><th className="px-3 py-2 text-right">Earnings</th><th className="px-3 py-2 text-right">Overtime</th><th className="px-3 py-2 text-right">Incentive + bonus</th><th className="px-3 py-2 text-right">Deductions</th><th className="px-3 py-2 text-right">Leave cut</th><th className="px-3 py-2 text-right">Net</th><th /></tr></thead>
              <tbody>
                {slips.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5"><p className="font-medium text-slate-900">{p.employee.name}</p><p className="text-xs text-slate-500">{p.employee.code}</p></td>
                    <td className="tabular px-3 py-2.5 text-right">{formatINR(num(p.basic) + num(p.hra) + num(p.allowances))}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatINR(p.overtime)}</td><td className="tabular px-3 py-2.5 text-right">{formatINR(num(p.incentives) + num(p.bonus))}</td>
                    <td className="tabular px-3 py-2.5 text-right">{formatINR(p.deductions)}</td><td className="tabular px-3 py-2.5 text-right">{formatINR(p.leaveDeduction)}</td>
                    <td className="tabular px-3 py-2.5 text-right font-semibold text-slate-900">{formatINR(p.netSalary)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {c.can("payroll:edit") && <FormDialog title={`Adjust – ${p.employee.name}`} description="Add incentives or a bonus. Net salary is recalculated." trigger={<Button size="sm" variant="ghost">Adjust</Button>} fields={[{ name: "incentives", label: "Incentives (₹)", type: "number", defaultValue: num(p.incentives) }, { name: "bonus", label: "Bonus (₹)", type: "number", defaultValue: num(p.bonus) }, { name: "deductions", label: "Total deductions (₹)", type: "number", defaultValue: num(p.deductions), hint: "Change only to correct a one-off deduction" }]} action={adjustPayslip.bind(null, p.id)} />}
                      <a href={`/hr/payslips/${p.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex p-2 text-brand-700" aria-label="Download payslip"><FileDown className="h-4 w-4" /></a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
