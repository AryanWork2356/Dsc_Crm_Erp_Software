"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EmploymentStatus, LeaveKind } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { requestApproval } from "@/lib/workflow";
import { computePayslip, leaveDaysInMonth, readPayrollConfig } from "@/lib/payroll";
import { formToObject, zDate, zEmail, zNumPos, zOptDate, zOptStr, zPhone, zReqStr } from "@/lib/form";
import { num, round2, startOfDay } from "@/lib/utils";
import { evaluateLeave } from "@/lib/leave-policy";
import { nextEmployeeCode } from "@/lib/employee-code";
import { daysNotice } from "@/lib/material-notice";
import { planRecoveries, saveRecoveries } from "@/lib/advances";

// ───────────── EMPLOYEES ─────────────
const empSchema = z.object({
  name: zReqStr("Name is required"),
  email: zEmail,
  phone: zPhone,
  designation: zOptStr,
  department: zOptStr,
  joiningDate: zOptDate,
  managerId: zOptStr,
  workLocation: zOptStr,
  emergencyContact: zOptStr,
});

export async function createEmployee(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("employees:create");
    const d = empSchema.parse(formToObject(fd));
    const e = await db.$transaction(async (tx) => {
      const code = await nextEmployeeCode(tx, c.companyId);
      const x = await tx.employee.create({ data: { ...d, companyId: c.companyId, code, managerId: d.managerId ?? null } });
      await audit(c, { action: "CREATE", entityType: "Employee", entityId: x.id, summary: `Onboarded employee ${code} – ${d.name}${d.designation ? ` (${d.designation})` : ""}` }, tx);
      return x;
    });
    revalidatePath("/hr/employees");
    return { message: `Employee ${e.code} added`, data: { id: e.id } };
  });
}

export async function updateEmployee(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("employees:edit");
    const d = empSchema.parse(formToObject(fd));
    const old = await db.employee.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!old) throw new UserError("Employee not found.");
    if (d.managerId === id) throw new UserError("An employee can't be their own manager.");
    await db.employee.update({ where: { id }, data: { ...d, managerId: d.managerId ?? null } });
    await audit(c, { action: "UPDATE", entityType: "Employee", entityId: id, summary: `Updated employee ${old.code} – ${old.name}` });
    revalidatePath("/hr/employees");
    revalidatePath(`/hr/employees/${id}`);
    return { message: "Employee updated" };
  });
}

export async function setEmployeeStatus(id: string, status: string) {
  return run(async () => {
    const c = await assertPerm("employees:edit");
    const s = z.nativeEnum(EmploymentStatus).parse(status);
    const e = await db.employee.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!e) throw new UserError("Employee not found.");
    if (e.userId === c.userId && s !== "ACTIVE") throw new UserError("You can't change your own employment status.");
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { status: s } });
      if (e.userId) await tx.user.update({ where: { id: e.userId }, data: { isActive: s !== "EXITED" } });
      await audit(c, { action: "UPDATE", entityType: "Employee", entityId: id, summary: `${e.name} (${e.code}) marked ${s.toLowerCase().replace("_", " ")}${s === "EXITED" ? " – login disabled" : ""}` }, tx);
    });
    revalidatePath("/hr/employees");
    return { message: "Status updated" };
  });
}

const salarySchema = z.object({ basic: zNumPos(), hra: zNumPos().default(0), allowances: zNumPos().default(0), deductions: zNumPos().default(0) });

export async function saveSalaryStructure(employeeId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("payroll:edit");
    if (!c.can("salary:view")) throw new UserError("You don't have access to salary information.");
    const d = salarySchema.parse(formToObject(fd));
    const e = await db.employee.findFirst({ where: { id: employeeId, companyId: c.companyId, deletedAt: null } });
    if (!e) throw new UserError("Employee not found.");
    const old = await db.salaryStructure.findUnique({ where: { employeeId } });
    await db.salaryStructure.upsert({ where: { employeeId }, create: { companyId: c.companyId, employeeId, ...d }, update: d });
    const gross = (x: { basic: unknown; hra: unknown; allowances: unknown }) => num(x.basic as number) + num(x.hra as number) + num(x.allowances as number);
    await audit(c, { action: "UPDATE", entityType: "SalaryStructure", entityId: employeeId, summary: `Salary of ${e.name} changed${old ? ` from ₹${gross(old).toLocaleString("en-IN")} to ₹${gross(d).toLocaleString("en-IN")} gross` : ` – set to ₹${gross(d).toLocaleString("en-IN")} gross`}`, oldValue: old ? { basic: num(old.basic), hra: num(old.hra), allowances: num(old.allowances) } : null, newValue: d });
    revalidatePath(`/hr/employees/${employeeId}`);
    return { message: "Salary structure saved" };
  });
}

// ───────────── LEAVES ─────────────
const leaveSchema = z.object({ fromDate: zDate("Pick the first day"), toDate: zDate("Pick the last day"), reason: zOptStr, paid: z.boolean().default(true), kind: z.nativeEnum(LeaveKind).default("REGULAR") });

export async function applyLeave(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("leaves:create");
    const d = leaveSchema.parse(formToObject(fd));
    if (d.toDate < d.fromDate) throw new UserError("The last day can't be before the first day.");
    const emp = await db.employee.findFirst({ where: { companyId: c.companyId, userId: c.userId, deletedAt: null } });
    if (!emp) throw new UserError("No employee profile is linked to your login.");
    // count working days (Sundays excluded)
    let days = 0;
    for (let t = startOfDay(d.fromDate).getTime(); t <= startOfDay(d.toDate).getTime(); t += 86400000) if (new Date(t).getDay() !== 0) days++;
    if (days === 0) throw new UserError("That range has no working days.");
    if (days > 60) throw new UserError("Leave can't be longer than 60 days in one request.");
    const overlap = await db.leave.findFirst({ where: { employeeId: emp.id, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: d.toDate }, toDate: { gte: d.fromDate } } });
    if (overlap) throw new UserError("You already have leave requested or approved for these dates.");
    // company leave policy (Code of Conduct): notice period, long leave, yearly cap
    const st = await db.companySettings.findUnique({ where: { companyId: c.companyId }, select: { leaveNoticeDays: true, longLeaveNoticeDays: true, leaveYearlyCap: true } });
    const policy = { noticeDays: st?.leaveNoticeDays ?? 15, longNoticeDays: st?.longLeaveNoticeDays ?? 90, yearlyCap: st?.leaveYearlyCap ?? 30 };
    const yr = d.fromDate.getUTCFullYear();
    const used = await db.leave.aggregate({ where: { employeeId: emp.id, status: { in: ["PENDING", "APPROVED"] }, fromDate: { gte: new Date(Date.UTC(yr, 0, 1)), lt: new Date(Date.UTC(yr + 1, 0, 1)) } }, _sum: { days: true } });
    const v = evaluateLeave({ kind: d.kind, days, noticeDays: daysNotice(d.fromDate), usedThisYear: num(used._sum.days), policy });
    if (v.error) throw new UserError(v.error);
    if ((v.kind === "MEDICAL" || v.kind === "EMERGENCY") && !d.reason) throw new UserError("Tell us the reason – it is needed for medical and emergency leave.");
    const leave = await db.$transaction(async (tx) => {
      const l = await tx.leave.create({ data: { companyId: c.companyId, employeeId: emp.id, fromDate: d.fromDate, toDate: d.toDate, days, reason: d.reason, paid: d.paid, kind: v.kind, exceedsCap: v.exceedsCap } });
      await requestApproval(tx, c, { type: "LEAVE", entityType: "Leave", entityId: l.id, title: `${v.kind === "LONG" ? "Long leave" : v.kind === "MEDICAL" ? "Medical leave" : v.kind === "EMERGENCY" ? "Emergency leave" : "Leave"} – ${emp.name}, ${days} day(s)${v.exceedsCap ? " (above yearly cap)" : ""}`, amount: 0, requiredRole: v.requiredRole });
      return tx.leave.findUniqueOrThrow({ where: { id: l.id } });
    });
    revalidatePath("/hr/leaves");
    return { message: leave.status === "APPROVED" ? "Leave approved" : v.requiredRole === "OWNER" ? "Sent to the Managing Director for written approval" : v.requiredRole === "MANAGEMENT" ? "Long leave sent for Management approval" : "Leave request sent to HR" };
  });
}

export async function cancelLeave(id: string) {
  return run(async () => {
    const c = await assertPerm("leaves:view");
    const l = await db.leave.findFirst({ where: { id, companyId: c.companyId }, include: { employee: true } });
    if (!l) throw new UserError("Leave not found.");
    const mine = l.employee.userId === c.userId;
    if (!mine && !c.can("leaves:manage")) throw new UserError("You can only cancel your own leave.");
    if (l.status === "REJECTED") throw new UserError("This request was already rejected.");
    if (l.fromDate < startOfDay() && l.status === "APPROVED") throw new UserError("Leave that has already started can't be cancelled.");
    await db.$transaction(async (tx) => {
      await tx.leave.delete({ where: { id } });
      await tx.approval.updateMany({ where: { entityType: "Leave", entityId: id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), remarks: "Cancelled by employee" } });
      await audit(c, { action: "DELETE", entityType: "Leave", entityId: id, summary: `Leave of ${l.employee.name} (${l.fromDate.toISOString().slice(0, 10)} – ${l.toDate.toISOString().slice(0, 10)}) cancelled` }, tx);
    });
    revalidatePath("/hr/leaves");
    return { message: "Leave cancelled" };
  });
}

// ───────────── ANNOUNCEMENTS ─────────────
const annSchema = z.object({ title: zReqStr("Title is required"), body: zReqStr("Write the announcement"), pinned: z.boolean().default(false), expiresAt: zOptDate });

export async function createAnnouncement(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("employees:create");
    const d = annSchema.parse(formToObject(fd));
    const a = await db.announcement.create({ data: { ...d, companyId: c.companyId, createdById: c.userId } });
    const users = await db.user.findMany({ where: { companyId: c.companyId, isActive: true, deletedAt: null, role: { notIn: ["CLIENT", "VENDOR"] } }, select: { id: true } });
    await db.notification.createMany({ data: users.filter((u) => u.id !== c.userId).map((u) => ({ companyId: c.companyId, userId: u.id, type: "GENERAL" as const, title: `Announcement: ${d.title}`, body: d.body.slice(0, 200), link: "/hr/announcements", dedupeKey: `ann:${a.id}` })), skipDuplicates: true });
    await audit(c, { action: "CREATE", entityType: "Announcement", entityId: a.id, summary: `Posted announcement “${d.title}”` });
    revalidatePath("/hr/announcements");
    return { message: "Announcement posted" };
  });
}

export async function deleteAnnouncement(id: string) {
  return run(async () => {
    const c = await assertPerm("employees:edit");
    const a = await db.announcement.findFirst({ where: { id, companyId: c.companyId } });
    if (!a) throw new UserError("Announcement not found.");
    await db.announcement.delete({ where: { id } });
    await audit(c, { action: "DELETE", entityType: "Announcement", entityId: id, summary: `Removed announcement “${a.title}”` });
    revalidatePath("/hr/announcements");
    return { message: "Announcement removed" };
  });
}

// ───────────── PAYROLL ─────────────
const periodSchema = z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2020).max(2100) });

/** Generates (or refreshes) payslips for every active employee with a salary structure. Safe to re-run. */
export async function runPayroll(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("payroll:create");
    if (!c.can("salary:view")) throw new UserError("You don't have access to salary information.");
    const { month, year } = periodSchema.parse(formToObject(fd));
    const now = new Date();
    if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) throw new UserError("You can't run payroll for a future month.");
    const settings = await db.companySettings.findUnique({ where: { companyId: c.companyId } });
    const cfg = readPayrollConfig(settings?.payrollConfig);
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    const emps = await db.employee.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { not: "EXITED" }, salaryStructure: { isNot: null } }, include: { salaryStructure: true } });
    if (!emps.length) throw new UserError("No employees have a salary structure yet.");
    const [leaves, att] = await Promise.all([
      db.leave.findMany({ where: { companyId: c.companyId, status: "APPROVED", fromDate: { lte: to }, toDate: { gte: from } } }),
      db.attendance.findMany({ where: { companyId: c.companyId, employeeId: { not: null }, date: { gte: from, lte: to } } }),
    ]);

    let created = 0;
    let updated = 0;
    let total = 0;
    await db.$transaction(async (tx) => {
      for (const e of emps) {
        const s = e.salaryStructure!;
        const mine = leaves.filter((l) => l.employeeId === e.id);
        const paidLeave = mine.filter((l) => l.paid).reduce((x, l) => x + leaveDaysInMonth(l.fromDate, l.toDate, year, month), 0);
        const unpaidLeave = mine.filter((l) => !l.paid).reduce((x, l) => x + leaveDaysInMonth(l.fromDate, l.toDate, year, month), 0);
        const rec = att.filter((a) => a.employeeId === e.id);
        const absent = rec.filter((a) => a.status === "ABSENT").length + rec.filter((a) => a.status === "HALF_DAY").length * 0.5;
        const ot = rec.reduce((x, a) => x + num(a.overtimeHrs), 0);
        const existing = await tx.payslip.findUnique({ where: { employeeId_month_year: { employeeId: e.id, month, year } } });
        const r = computePayslip({
          basic: num(s.basic), hra: num(s.hra), allowances: num(s.allowances), structureDeductions: num(s.deductions), config: cfg,
          paidLeaveDays: paidLeave, unpaidLeaveDays: unpaidLeave, absentDays: absent, overtimeHours: ot,
          incentives: num(existing?.incentives), bonus: num(existing?.bonus),
        });
        const adv = await planRecoveries(tx, e.id, month, year); // advances are recovered in instalments
        const net = Math.max(0, round2(r.netSalary - adv.total));
        const data = { companyId: c.companyId, employeeId: e.id, month, year, workingDays: cfg.workingDays, presentDays: r.presentDays, basic: s.basic, hra: s.hra, allowances: s.allowances, overtime: r.overtime, incentives: existing?.incentives ?? 0, bonus: existing?.bonus ?? 0, deductions: round2(r.deductions + adv.total), advanceRecovery: adv.total, leaveDeduction: r.leaveDeduction, netSalary: net };
        if (existing) {
          await tx.payslip.update({ where: { id: existing.id }, data });
          updated++;
        } else {
          await tx.payslip.create({ data });
          created++;
        }
        await saveRecoveries(tx, month, year, adv.items);
        total += net;
      }
      await audit(c, { action: "CREATE", entityType: "Payslip", summary: `${c.name} ran payroll for ${String(month).padStart(2, "0")}/${year}: ${created} new, ${updated} refreshed, net ₹${round2(total).toLocaleString("en-IN")}` }, tx);
    });
    revalidatePath("/hr/payroll");
    return { message: `Payroll ready: ${created + updated} payslips, net ₹${round2(total).toLocaleString("en-IN")}` };
  });
}

const adjustSchema = z.object({ incentives: zNumPos().default(0), bonus: zNumPos().default(0), deductions: zNumPos().optional() });

/** Add incentives / bonus (or override deductions) on a generated payslip, then recompute net. */
export async function adjustPayslip(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("payroll:edit");
    if (!c.can("salary:view")) throw new UserError("You don't have access to salary information.");
    const d = adjustSchema.parse(formToObject(fd));
    const p = await db.payslip.findFirst({ where: { id, companyId: c.companyId }, include: { employee: true } });
    if (!p) throw new UserError("Payslip not found.");
    const deductions = d.deductions ?? num(p.deductions);
    const net = Math.max(0, round2(num(p.basic) + num(p.hra) + num(p.allowances) + num(p.overtime) + d.incentives + d.bonus - deductions - num(p.leaveDeduction)));
    await db.payslip.update({ where: { id }, data: { incentives: d.incentives, bonus: d.bonus, deductions, netSalary: net } });
    await audit(c, { action: "UPDATE", entityType: "Payslip", entityId: id, summary: `Adjusted payslip of ${p.employee.name} (${p.month}/${p.year}): net ₹${num(p.netSalary).toLocaleString("en-IN")} → ₹${net.toLocaleString("en-IN")}`, oldValue: { net: num(p.netSalary) }, newValue: { net } });
    revalidatePath("/hr/payroll");
    return { message: "Payslip updated" };
  });
}

const cfgSchema = z.object({
  workingDays: z.coerce.number().int().min(20).max(31), useAttendance: z.boolean().default(false), paidLeavesPerMonth: z.coerce.number().min(0).max(31),
  overtimeMultiplier: z.coerce.number().min(1).max(4), pfPercent: z.coerce.number().min(0).max(30), fixedDeduction: z.coerce.number().min(0), hoursPerDay: z.coerce.number().min(4).max(12),
});

export async function savePayrollConfig(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("payroll:edit");
    const d = cfgSchema.parse(formToObject(fd));
    const old = await db.companySettings.findUnique({ where: { companyId: c.companyId } });
    await db.companySettings.upsert({ where: { companyId: c.companyId }, update: { payrollConfig: d }, create: { companyId: c.companyId, payrollConfig: d } });
    await audit(c, { action: "UPDATE", entityType: "CompanySettings", entityId: c.companyId, summary: "Payroll rules updated", oldValue: old?.payrollConfig ?? null, newValue: d });
    revalidatePath("/hr/payroll");
    return { message: "Payroll rules saved" };
  });
}


// ───────────── EMPLOYEE ADVANCES ─────────────
const advanceSchema = z.object({
  employeeId: zReqStr("Choose the employee"),
  amount: z.coerce.number({ message: "Enter the amount" }).positive("Amount must be above 0"),
  monthlyRecovery: z.coerce.number({ message: "Enter the monthly recovery" }).positive("Monthly recovery must be above 0"),
  givenOn: zOptDate,
  reason: zOptStr,
});

/** Advance given to an employee, recovered from salary in monthly instalments by payroll. */
export async function giveAdvance(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("payroll:create");
    if (!c.can("salary:view")) throw new UserError("You don't have access to salary information.");
    const d = advanceSchema.parse(formToObject(fd));
    if (d.monthlyRecovery > d.amount) throw new UserError("The monthly recovery can't be more than the advance.");
    const e = await db.employee.findFirst({ where: { id: d.employeeId, companyId: c.companyId, deletedAt: null, status: { not: "EXITED" } } });
    if (!e) throw new UserError("Employee not found, or has left.");
    const open = await db.employeeAdvance.aggregate({ where: { employeeId: e.id, status: "OPEN" }, _sum: { amount: true } });
    const a = await db.$transaction(async (tx) => {
      const x = await tx.employeeAdvance.create({ data: { companyId: c.companyId, employeeId: e.id, amount: d.amount, monthlyRecovery: d.monthlyRecovery, givenOn: d.givenOn ?? new Date(), reason: d.reason, createdById: c.userId } });
      await audit(c, { action: "CREATE", entityType: "EmployeeAdvance", entityId: x.id, summary: `Gave advance ₹${d.amount.toLocaleString("en-IN")} to ${e.name}, recovered ₹${d.monthlyRecovery.toLocaleString("en-IN")} a month${num(open._sum.amount) > 0 ? " (other advances still open)" : ""}` }, tx);
      return x;
    });
    revalidatePath("/hr/advances");
    return { message: `Advance recorded – ${Math.ceil(d.amount / d.monthlyRecovery)} month(s) of recovery from payroll`, data: { id: a.id } };
  });
}

/** Stops recovery and closes an advance that will not be repaid. Management / Owner only. */
export async function writeOffAdvance(id: string, fd?: FormData) {
  return run(async () => {
    const c = await assertPerm("payroll:edit");
    if (!["OWNER", "MANAGEMENT"].includes(c.role)) throw new UserError("Only Management or the Owner can write off an advance.");
    const note = String(fd?.get("note") ?? "").trim();
    if (!note) throw new UserError("Write the reason.");
    const a = await db.employeeAdvance.findFirst({ where: { id, companyId: c.companyId }, include: { employee: true, recoveries: true } });
    if (!a) throw new UserError("Advance not found.");
    if (a.status !== "OPEN") throw new UserError("This advance is already closed.");
    const left = round2(num(a.amount) - a.recoveries.reduce((s, r) => s + num(r.amount), 0));
    await db.employeeAdvance.update({ where: { id }, data: { status: "WRITTEN_OFF" } });
    await audit(c, { action: "UPDATE", entityType: "EmployeeAdvance", entityId: id, summary: `Wrote off ₹${left.toLocaleString("en-IN")} of ${a.employee.name}'s advance: ${note}` });
    revalidatePath("/hr/advances");
    return { message: "Advance written off" };
  });
}
