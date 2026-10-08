import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { inr, loadCompany, pdfResponse, renderPdf } from "@/lib/pdf";
import { num } from "@/lib/utils";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (!c) return new Response("Forbidden", { status: 403 });
  const p = await db.payslip.findFirst({ where: { id, companyId: c.companyId }, include: { employee: true } });
  if (!p) return new Response("Not found", { status: 404 });
  // own payslip, or payroll access
  if (p.employee.userId !== c.userId && !(c.can("payroll:view") && c.can("salary:view"))) return new Response("Forbidden", { status: 403 });

  const company = await loadCompany(c.companyId);
  const earnings = num(p.basic) + num(p.hra) + num(p.allowances) + num(p.overtime) + num(p.incentives) + num(p.bonus);
  const buf = await renderPdf(company, {
    title: "PAYSLIP",
    number: `${MONTHS[p.month - 1]} ${p.year}`,
    meta: [["Working days", String(p.workingDays)], ["Days paid", String(num(p.presentDays))]],
    party: { heading: "Employee", lines: [p.employee.name, `${p.employee.code}${p.employee.designation ? ` · ${p.employee.designation}` : ""}`, p.employee.department ?? ""].filter(Boolean) },
    columns: [{ header: "Earnings", width: 260 }, { header: "Amount", width: 120, align: "right" }, { header: "Deductions", width: 200 }, { header: "Amount", width: 120, align: "right" }],
    rows: [
      { cells: ["Basic", inr(p.basic), "Standard deductions", inr(p.deductions)] },
      { cells: ["House rent allowance", inr(p.hra), "Leave / absence", inr(p.leaveDeduction)] },
      { cells: ["Other allowances", inr(p.allowances), "", ""] },
      { cells: ["Overtime", inr(p.overtime), "", ""] },
      { cells: ["Incentives", inr(p.incentives), "", ""] },
      { cells: ["Bonus", inr(p.bonus), "", ""] },
      { kind: "subtotal", cells: ["Total earnings", inr(earnings), "Total deductions", inr(num(p.deductions) + num(p.leaveDeduction))] },
    ],
    totals: [["Net salary", inr(p.netSalary)]],
    note: "This is a computer-generated payslip.",
  });
  return pdfResponse(buf, `payslip-${p.employee.code}-${p.year}-${String(p.month).padStart(2, "0")}.pdf`);
}
