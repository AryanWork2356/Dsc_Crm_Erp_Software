"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AttendanceStatus, PaymentMethod, WageType, WorkerTrade, type AttendanceMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm, hashPassword, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextNumber } from "@/lib/sequence";
import { projectScope } from "@/lib/scope";
import { dayWageCost, readPayrollConfig } from "@/lib/payroll";
import { formToObject, zDate, zNumPos, zOptDate, zOptStr, zPhone, zReqStr } from "@/lib/form";
import { calendarDay, num } from "@/lib/utils";

// ───────────── WORKERS ─────────────
const workerSchema = z.object({
  name: zReqStr("Name is required"),
  phone: zPhone,
  trade: z.nativeEnum(WorkerTrade).default("HELPER"),
  skill: zOptStr,
  contractorId: zOptStr,
  currentProjectId: zOptStr,
  wageType: z.nativeEnum(WageType).default("DAILY"),
  dailyWage: zNumPos().default(0),
  monthlyWage: zNumPos().default(0),
  joiningDate: zOptDate,
  emergencyContact: zOptStr,
});

function checkWage(d: z.infer<typeof workerSchema>) {
  if (d.wageType === "DAILY" && d.dailyWage <= 0) throw new UserError("Enter the daily wage.");
  if (d.wageType === "MONTHLY" && d.monthlyWage <= 0) throw new UserError("Enter the monthly wage.");
}

export async function createWorker(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("workers:create");
    const d = workerSchema.parse(formToObject(fd));
    checkWage(d);
    const w = await db.$transaction(async (tx) => {
      const code = await nextNumber(tx, c.companyId, "W");
      const x = await tx.worker.create({ data: { ...d, companyId: c.companyId, code, contractorId: d.contractorId ?? null, currentProjectId: d.currentProjectId ?? null } });
      await audit(c, { action: "CREATE", entityType: "Worker", entityId: x.id, summary: `Added worker ${code} – ${d.name} (${d.trade})` }, tx);
      return x;
    });
    revalidatePath("/workforce/workers");
    return { message: `Worker ${w.code} added`, data: { id: w.id } };
  });
}

export async function updateWorker(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("workers:edit");
    const d = workerSchema.parse(formToObject(fd));
    checkWage(d);
    const old = await db.worker.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!old) throw new UserError("Worker not found.");
    await db.worker.update({ where: { id }, data: { ...d, contractorId: d.contractorId ?? null, currentProjectId: d.currentProjectId ?? null } });
    const wageChanged = num(old.dailyWage) !== d.dailyWage || num(old.monthlyWage) !== d.monthlyWage;
    await audit(c, { action: "UPDATE", entityType: "Worker", entityId: id, summary: wageChanged ? `Changed wage of ${old.name} (${old.code}): daily ₹${num(old.dailyWage)} → ₹${d.dailyWage}, monthly ₹${num(old.monthlyWage)} → ₹${d.monthlyWage}` : `Updated worker ${old.code} – ${old.name}` });
    revalidatePath("/workforce/workers");
    return { message: "Worker updated" };
  });
}

export async function setWorkerActive(id: string, active: boolean) {
  return run(async () => {
    const c = await assertPerm("workers:edit");
    const w = await db.worker.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!w) throw new UserError("Worker not found.");
    await db.$transaction(async (tx) => {
      await tx.worker.update({ where: { id }, data: { isActive: active } });
      if (!active) await tx.user.updateMany({ where: { workerId: id }, data: { isActive: false } });
      await audit(c, { action: active ? "ACTIVATE" : "DEACTIVATE", entityType: "Worker", entityId: id, summary: `${active ? "Reactivated" : "Deactivated"} worker ${w.code} – ${w.name}` }, tx);
    });
    revalidatePath("/workforce/workers");
    return { message: active ? "Worker reactivated" : "Worker deactivated" };
  });
}

export async function deleteWorker(id: string) {
  return run(async () => {
    const c = await assertPerm("workers:delete");
    const w = await db.worker.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!w) throw new UserError("Worker not found.");
    if (await db.attendance.count({ where: { workerId: id } })) throw new UserError("This worker has attendance history, so it can't be deleted. Deactivate them instead.");
    await db.worker.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(c, { action: "DELETE", entityType: "Worker", entityId: id, summary: `Deleted worker ${w.code} – ${w.name}` });
    revalidatePath("/workforce/workers");
    return { message: "Worker deleted" };
  });
}

/** Gives a worker a phone login to the simple mobile screen. Login ID is the generated worker id. */
export async function createWorkerLogin(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("users:manage");
    const { password } = z.object({ password: z.string().min(6, "Use at least 6 characters") }).parse(formToObject(fd));
    const w = await db.worker.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!w) throw new UserError("Worker not found.");
    const email = `${w.code.toLowerCase()}@workers.local`;
    const existing = await db.user.findFirst({ where: { companyId: c.companyId, workerId: id } });
    if (existing) {
      await db.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password), isActive: true } });
      await audit(c, { action: "UPDATE", entityType: "User", entityId: existing.id, summary: `Reset mobile login password for worker ${w.code}` });
      return { message: `Password updated. Login ID: ${email}` };
    }
    const u = await db.user.create({ data: { companyId: c.companyId, email, name: w.name, phone: w.phone, role: "WORKER", workerId: id, passwordHash: await hashPassword(password) } });
    await audit(c, { action: "CREATE", entityType: "User", entityId: u.id, summary: `Created mobile login for worker ${w.code}` });
    revalidatePath("/workforce/workers");
    return { message: `Login created. Login ID: ${email}` };
  });
}

// ───────────── CONTRACTORS ─────────────
const contractorSchema = z.object({ name: zReqStr("Name is required"), contactPerson: zOptStr, phone: zPhone, email: z.string().trim().email("Enter a valid email").optional(), gstin: zOptStr, rating: z.coerce.number().int().min(1).max(5).optional(), notes: zOptStr });

export async function createContractor(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("contractors:create");
    const d = contractorSchema.parse(formToObject(fd));
    const x = await db.contractor.create({ data: { ...d, companyId: c.companyId } });
    await audit(c, { action: "CREATE", entityType: "Contractor", entityId: x.id, summary: `Added contractor ${d.name}` });
    revalidatePath("/workforce/contractors");
    return { message: "Contractor added", data: { id: x.id } };
  });
}

export async function updateContractor(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("contractors:edit");
    const d = contractorSchema.parse(formToObject(fd));
    const old = await db.contractor.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!old) throw new UserError("Contractor not found.");
    await db.contractor.update({ where: { id }, data: d });
    await audit(c, { action: "UPDATE", entityType: "Contractor", entityId: id, summary: `Updated contractor ${old.name}` });
    revalidatePath("/workforce/contractors");
    revalidatePath(`/workforce/contractors/${id}`);
    return { message: "Contractor updated" };
  });
}

export async function deleteContractor(id: string) {
  return run(async () => {
    const c = await assertPerm("contractors:delete");
    const x = await db.contractor.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!x) throw new UserError("Contractor not found.");
    const used = (await db.worker.count({ where: { contractorId: id, deletedAt: null } })) + (await db.workOrder.count({ where: { contractorId: id } })) + (await db.contractorPayment.count({ where: { contractorId: id } }));
    if (used) throw new UserError("This contractor has workers, work orders or payments, so it can't be deleted.");
    await db.contractor.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(c, { action: "DELETE", entityType: "Contractor", entityId: id, summary: `Deleted contractor ${x.name}` });
    revalidatePath("/workforce/contractors");
    return { message: "Contractor deleted" };
  });
}

const woSchema = z.object({ title: zReqStr("Describe the work"), projectId: zOptStr, scope: zOptStr, rateNote: zOptStr, amount: zNumPos().default(0), startDate: zOptDate, endDate: zOptDate });

export async function createWorkOrder(contractorId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("contractors:edit");
    const d = woSchema.parse(formToObject(fd));
    if (d.startDate && d.endDate && d.endDate < d.startDate) throw new UserError("End date can't be before the start date.");
    const ct = await db.contractor.findFirst({ where: { id: contractorId, companyId: c.companyId, deletedAt: null } });
    if (!ct) throw new UserError("Contractor not found.");
    if (d.projectId && !(await db.project.findFirst({ where: { id: d.projectId, ...projectScope(c) } }))) throw new UserError("Project not found.");
    const wo = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, c.companyId, "WO");
      const x = await tx.workOrder.create({ data: { ...d, companyId: c.companyId, contractorId, number, projectId: d.projectId ?? null } });
      await audit(c, { action: "CREATE", entityType: "WorkOrder", entityId: x.id, summary: `Work order ${number} for ${ct.name}: ${d.title} (₹${d.amount.toLocaleString("en-IN")})` }, tx);
      return x;
    });
    revalidatePath(`/workforce/contractors/${contractorId}`);
    return { message: `Work order ${wo.number} created` };
  });
}

export async function setWorkOrderStatus(id: string, status: string) {
  return run(async () => {
    const c = await assertPerm("contractors:edit");
    const s = z.enum(["OPEN", "COMPLETED", "CANCELLED"]).parse(status);
    const wo = await db.workOrder.findFirst({ where: { id, companyId: c.companyId } });
    if (!wo) throw new UserError("Work order not found.");
    await db.workOrder.update({ where: { id }, data: { status: s } });
    await audit(c, { action: "UPDATE", entityType: "WorkOrder", entityId: id, summary: `Work order ${wo.number} marked ${s.toLowerCase()}` });
    revalidatePath(`/workforce/contractors/${wo.contractorId}`);
    return { message: `Marked ${s.toLowerCase()}` };
  });
}

const cpSchema = z.object({ amount: z.coerce.number({ message: "Enter the amount" }).positive("Amount must be above 0"), date: zDate("Pick the payment date"), workOrderId: zOptStr, method: z.nativeEnum(PaymentMethod).default("BANK_TRANSFER"), reference: zOptStr, notes: zOptStr });

/** Money paid to a labour contractor – counted as vendor/labour cost on the work order's project. */
export async function recordContractorPayment(contractorId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("payments:create");
    const d = cpSchema.parse(formToObject(fd));
    const ct = await db.contractor.findFirst({ where: { id: contractorId, companyId: c.companyId, deletedAt: null } });
    if (!ct) throw new UserError("Contractor not found.");
    let projectId: string | null = null;
    if (d.workOrderId) {
      const wo = await db.workOrder.findFirst({ where: { id: d.workOrderId, contractorId, companyId: c.companyId } });
      if (!wo) throw new UserError("That work order doesn't belong to this contractor.");
      if (wo.status === "CANCELLED") throw new UserError("This work order is cancelled.");
      projectId = wo.projectId;
      const paid = await db.contractorPayment.aggregate({ where: { workOrderId: wo.id }, _sum: { amount: true } });
      if (num(wo.amount) > 0 && num(paid._sum.amount) + d.amount > num(wo.amount) + 0.001) throw new UserError(`This would exceed the work order value of ₹${num(wo.amount).toLocaleString("en-IN")} (already paid ₹${num(paid._sum.amount).toLocaleString("en-IN")}).`);
    }
    await db.contractorPayment.create({ data: { ...d, companyId: c.companyId, contractorId, workOrderId: d.workOrderId ?? null, projectId } });
    await audit(c, { action: "CREATE", entityType: "ContractorPayment", entityId: contractorId, summary: `Paid ₹${d.amount.toLocaleString("en-IN")} to contractor ${ct.name}${d.reference ? ` (ref ${d.reference})` : ""}` });
    revalidatePath(`/workforce/contractors/${contractorId}`);
    return { message: "Payment recorded" };
  });
}

// ───────────── ATTENDANCE ─────────────
const entry = z.object({
  workerId: z.string().min(1),
  status: z.nativeEnum(AttendanceStatus),
  overtimeHrs: z.coerce.number().min(0).max(12).default(0),
});

async function payrollCfg(companyId: string) {
  const s = await db.companySettings.findUnique({ where: { companyId } });
  return readPayrollConfig(s?.payrollConfig);
}

async function projectForMarking(c: Ctx, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) } });
  if (!p) throw new UserError("Project not found or you don't have access to it.");
  return p;
}

/** Bulk attendance for one project on one day. Re-marking the same day updates the record. */
export async function markWorkerAttendance(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("attendance:create");
    const raw = formToObject(fd);
    const d = z.object({ projectId: zReqStr("Select the site"), date: zDate("Pick the date") }).parse(raw);
    let list: unknown;
    try {
      list = JSON.parse(String(raw.entries ?? "[]"));
    } catch {
      throw new UserError("Attendance data could not be read. Reload the page.");
    }
    const entries = z.array(entry).min(1, "Mark at least one worker").parse(list);
    const day = calendarDay(String(raw.date));
    if (day.getTime() > calendarDay().getTime()) throw new UserError("You can't mark attendance for a future date.");
    const project = await projectForMarking(c, d.projectId);
    const cfg = await payrollCfg(c.companyId);
    const workers = await db.worker.findMany({ where: { companyId: c.companyId, id: { in: entries.map((e) => e.workerId) }, deletedAt: null, isActive: true } });
    if (workers.length !== new Set(entries.map((e) => e.workerId)).size) throw new UserError("Some workers were not found or are inactive.");
    const wmap = new Map(workers.map((w) => [w.id, w]));

    let marked = 0;
    await db.$transaction(async (tx) => {
      for (const e of entries) {
        const w = wmap.get(e.workerId)!;
        const existing = await tx.attendance.findUnique({ where: { workerId_date: { workerId: w.id, date: day } } });
        if (existing?.projectId && existing.projectId !== d.projectId) {
          const other = await tx.project.findUnique({ where: { id: existing.projectId }, select: { code: true } });
          throw new UserError(`${w.name} is already marked at ${other?.code ?? "another site"} for this day.`);
        }
        const ot = e.status === "ABSENT" || e.status === "LEAVE" ? 0 : e.overtimeHrs;
        const status = ot > 0 && e.status === "PRESENT" ? "OVERTIME" : e.status;
        const wageCost = dayWageCost({ wageType: w.wageType, dailyWage: num(w.dailyWage), monthlyWage: num(w.monthlyWage) }, status, ot, cfg);
        const data = { companyId: c.companyId, date: day, workerId: w.id, projectId: d.projectId, status, method: "MANUAL" as const, overtimeHrs: ot, wageCost, markedById: c.userId };
        if (existing) await tx.attendance.update({ where: { id: existing.id }, data });
        else await tx.attendance.create({ data });
        marked++;
      }
      await audit(c, { action: "UPDATE", entityType: "Attendance", entityId: d.projectId, summary: `${c.name} marked attendance for ${marked} worker(s) at ${project.code} on ${day.toISOString().slice(0, 10)}` }, tx);
    });
    revalidatePath("/workforce/attendance");
    return { message: `Attendance saved for ${marked} worker(s)` };
  });
}

/** Staff attendance (office/site employees), marked by HR or managers. */
export async function markEmployeeAttendance(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("attendance:create");
    const raw = formToObject(fd);
    z.object({ date: zDate("Pick the date") }).parse(raw);
    let list: unknown;
    try {
      list = JSON.parse(String(raw.entries ?? "[]"));
    } catch {
      throw new UserError("Attendance data could not be read. Reload the page.");
    }
    const entries = z.array(z.object({ employeeId: z.string().min(1), status: z.nativeEnum(AttendanceStatus), overtimeHrs: z.coerce.number().min(0).max(12).default(0) })).min(1, "Mark at least one person").parse(list);
    if (!c.can("employees:view")) throw new UserError("Only HR and managers can mark staff attendance.");
    const day = calendarDay(String(raw.date));
    if (day.getTime() > calendarDay().getTime()) throw new UserError("You can't mark attendance for a future date.");
    const emps = await db.employee.findMany({ where: { companyId: c.companyId, id: { in: entries.map((e) => e.employeeId) }, deletedAt: null } });
    if (emps.length !== new Set(entries.map((e) => e.employeeId)).size) throw new UserError("Some employees were not found.");
    await db.$transaction(async (tx) => {
      for (const e of entries) {
        const data = { companyId: c.companyId, date: day, employeeId: e.employeeId, status: e.status, method: "MANUAL" as const, overtimeHrs: e.status === "ABSENT" || e.status === "LEAVE" ? 0 : e.overtimeHrs, wageCost: 0, markedById: c.userId };
        const ex = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: e.employeeId, date: day } } });
        if (ex) await tx.attendance.update({ where: { id: ex.id }, data });
        else await tx.attendance.create({ data });
      }
      await audit(c, { action: "UPDATE", entityType: "Attendance", summary: `${c.name} marked staff attendance for ${entries.length} employee(s) on ${day.toISOString().slice(0, 10)}` }, tx);
    });
    revalidatePath("/workforce/attendance");
    return { message: `Attendance saved for ${entries.length} employee(s)` };
  });
}

/** Self check-in from the phone (workers) or dashboard (staff). Idempotent per day. */
export async function checkIn(projectId?: string, lat?: number, lng?: number) {
  return run(async () => {
    const c = await assertPerm("attendance:create");
    const day = calendarDay();
    const method: AttendanceMethod = lat !== undefined && lng !== undefined ? "LOCATION" : "MOBILE";
    const user = await db.user.findUniqueOrThrow({ where: { id: c.userId } });
    if (user.workerId) {
      const w = await db.worker.findFirst({ where: { id: user.workerId, companyId: c.companyId, isActive: true } });
      if (!w) throw new UserError("Your worker profile is inactive. Contact your supervisor.");
      const pid = projectId ?? w.currentProjectId;
      if (!pid) throw new UserError("You aren't assigned to a site yet. Ask your supervisor.");
      const existing = await db.attendance.findUnique({ where: { workerId_date: { workerId: w.id, date: day } } });
      if (existing && existing.status !== "ABSENT") return { message: "You're already marked present today" };
      const cfg = await payrollCfg(c.companyId);
      const wageCost = dayWageCost({ wageType: w.wageType, dailyWage: num(w.dailyWage), monthlyWage: num(w.monthlyWage) }, "PRESENT", 0, cfg);
      const data = { companyId: c.companyId, date: day, workerId: w.id, projectId: pid, status: "PRESENT" as const, method, wageCost, latitude: lat ?? null, longitude: lng ?? null, markedById: c.userId };
      if (existing) await db.attendance.update({ where: { id: existing.id }, data });
      else await db.attendance.create({ data });
    } else {
      const emp = await db.employee.findFirst({ where: { companyId: c.companyId, userId: c.userId } });
      if (!emp) throw new UserError("No employee profile is linked to your login.");
      const existing = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: day } } });
      if (existing && existing.status !== "ABSENT") return { message: "You're already marked present today" };
      const data = { companyId: c.companyId, date: day, employeeId: emp.id, projectId: projectId ?? null, status: "PRESENT" as const, method, wageCost: 0, latitude: lat ?? null, longitude: lng ?? null, markedById: c.userId };
      if (existing) await db.attendance.update({ where: { id: existing.id }, data });
      else await db.attendance.create({ data });
    }
    revalidatePath("/workforce/attendance");
    revalidatePath("/worker");
    return { message: "Marked present. Have a good day!" };
  });
}
