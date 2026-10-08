import { FileDown } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatINR } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";

export const metadata = { title: "My Payslips" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every staff member can see ONLY their own payslips. */
export default async function MyPayslips() {
  const c = await requireCtx();
  const emp = await db.employee.findFirst({ where: { companyId: c.companyId, userId: c.userId, deletedAt: null } });
  const slips = emp ? await db.payslip.findMany({ where: { employeeId: emp.id }, orderBy: [{ year: "desc" }, { month: "desc" }] }) : [];
  return (
    <>
      <PageHeader title="My payslips" subtitle="Only you can see these." />
      <Card>
        {slips.length === 0 ? <EmptyState title="No payslips yet" /> : (
          <ul className="divide-y divide-slate-100">
            {slips.map((p) => <li key={p.id} className="flex items-center gap-4 px-5 py-4"><span className="font-medium text-slate-900">{MONTHS[p.month - 1]} {p.year}</span><span className="tabular ml-auto text-sm font-semibold">{formatINR(p.netSalary)}</span><a href={`/hr/payslips/${p.id}/pdf`} target="_blank" rel="noreferrer" className="text-brand-700" aria-label="Download"><FileDown className="h-5 w-5" /></a></li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
