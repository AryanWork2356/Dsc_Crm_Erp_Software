import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createWorker, updateWorker, markWorkerAttendance, markEmployeeAttendance, checkIn, createWorkOrder, recordContractorPayment, createWorkerLogin, deleteWorker, setWorkerActive } from "@/app/(app)/workforce/actions";
import { applyLeave, cancelLeave, runPayroll, adjustPayslip, saveSalaryStructure, setEmployeeStatus, createEmployee } from "@/app/(app)/hr/actions";
import { approveRequest } from "@/app/(app)/approvals/actions";
import { projectFinancials } from "@/lib/project-finance";

beforeEach(() => logout());
const entries = (rows: object[]) => JSON.stringify(rows);
const proj = (code: string) => db.project.findFirstOrThrow({ where: { code } });
const dateOnly = (s: string) => new Date(s + "T00:00:00.000Z");

describe("workers", () => {
  it("requires a wage that matches the pay type", async () => {
    await loginAs("hr@dsc.demo");
    expect((await createWorker(fd({ name: "No wage", trade: "HELPER", wageType: "DAILY", dailyWage: 0 }))).ok).toBe(false);
    expect((await createWorker(fd({ name: "Test Painter", trade: "PAINTER", wageType: "DAILY", dailyWage: 850, phone: "+91 98000 55555" }))).ok).toBe(true);
    const w = await db.worker.findFirstOrThrow({ where: { name: "Test Painter" } });
    expect(w.code).toMatch(/^W-\d{5}$/);
  });

  it("wage changes are audited with old and new amounts", async () => {
    await loginAs("hr@dsc.demo");
    const w = await db.worker.findFirstOrThrow({ where: { name: "Test Painter" } });
    expect((await updateWorker(w.id, fd({ name: "Test Painter", trade: "PAINTER", wageType: "DAILY", dailyWage: 900 }))).ok).toBe(true);
    const log = await db.auditLog.findFirst({ where: { entityId: w.id, summary: { contains: "Changed wage" } } });
    expect(log?.summary).toContain("850");
    expect(log?.summary).toContain("900");
  });

  it("workers with attendance can only be deactivated, not deleted", async () => {
    await loginAs("hr@dsc.demo");
    const w = await db.worker.findFirstOrThrow({ where: { code: "W-00002" } });
    expect((await deleteWorker(w.id)).ok).toBe(false);
    expect((await setWorkerActive(w.id, false)).ok).toBe(true);
    expect((await setWorkerActive(w.id, true)).ok).toBe(true);
    const fresh = await db.worker.findFirstOrThrow({ where: { name: "Test Painter" } });
    expect((await deleteWorker(fresh.id)).ok).toBe(true);
  });

  it("creates and resets a mobile login; deactivating the worker disables it", async () => {
    await loginAs("admin@dsc.demo");
    const w = await db.worker.findFirstOrThrow({ where: { code: "W-00010" } });
    expect((await createWorkerLogin(w.id, fd({ password: "123" }))).ok).toBe(false);
    expect((await createWorkerLogin(w.id, fd({ password: "site1234" }))).ok).toBe(true);
    const u = await db.user.findFirstOrThrow({ where: { workerId: w.id } });
    expect(u.role).toBe("WORKER");
    expect(u.email).toBe("w-00010@workers.local");
    await setWorkerActive(w.id, false);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).isActive).toBe(false);
  });
});

describe("attendance and wages", () => {
  it("stores a wage snapshot: full day, half day, absent, overtime", async () => {
    await loginAs("supervisor@dsc.demo");
    const p1 = await proj("PRJ-00001");
    const w = await db.worker.findFirstOrThrow({ where: { code: "W-00001" } }); // ₹1,100/day carpenter on PRJ-1
    const d = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10); // 40 days ago – no seeded attendance
    const run = async (status: string, overtimeHrs = 0) => {
      const r = await markWorkerAttendance(fd({ projectId: p1.id, date: d, entries: entries([{ workerId: w.id, status, overtimeHrs }]) }));
      expect(r.ok).toBe(true);
      return db.attendance.findUniqueOrThrow({ where: { workerId_date: { workerId: w.id, date: dateOnly(d) } } });
    };
    expect(Number((await run("PRESENT")).wageCost)).toBe(1100);
    expect(Number((await run("HALF_DAY")).wageCost)).toBe(550);
    expect(Number((await run("ABSENT")).wageCost)).toBe(0);
    const ot = await run("PRESENT", 4);
    expect(ot.status).toBe("OVERTIME");
    expect(Number(ot.wageCost)).toBe(1100 + 4 * (1100 / 8) * 1.5); // 1925
    // re-marking updates the same record, never duplicates
    expect(await db.attendance.count({ where: { workerId: w.id, date: dateOnly(d) } })).toBe(1);
  });

  it("wage snapshots survive a later wage change", async () => {
    await loginAs("hr@dsc.demo");
    const w = await db.worker.findFirstOrThrow({ where: { code: "W-00001" } });
    const d = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const before = Number((await db.attendance.findUniqueOrThrow({ where: { workerId_date: { workerId: w.id, date: dateOnly(d) } } })).wageCost);
    await updateWorker(w.id, fd({ name: w.name, trade: w.trade, wageType: "DAILY", dailyWage: 2000, currentProjectId: w.currentProjectId }));
    expect(Number((await db.attendance.findUniqueOrThrow({ where: { workerId_date: { workerId: w.id, date: dateOnly(d) } } })).wageCost)).toBe(before);
    await updateWorker(w.id, fd({ name: w.name, trade: w.trade, wageType: "DAILY", dailyWage: 1100, currentProjectId: w.currentProjectId }));
  });

  it("a worker can't be on two sites the same day; future dates are refused", async () => {
    await loginAs("director@dsc.demo");
    const p1 = await proj("PRJ-00001");
    const p2 = await proj("PRJ-00002");
    const w = await db.worker.findFirstOrThrow({ where: { code: "W-00003" } });
    const d = new Date(Date.now() - 41 * 86400000).toISOString().slice(0, 10);
    expect((await markWorkerAttendance(fd({ projectId: p1.id, date: d, entries: entries([{ workerId: w.id, status: "PRESENT" }]) }))).ok).toBe(true);
    const clash = await markWorkerAttendance(fd({ projectId: p2.id, date: d, entries: entries([{ workerId: w.id, status: "PRESENT" }]) }));
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error).toMatch(/already marked/);
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    expect((await markWorkerAttendance(fd({ projectId: p1.id, date: future, entries: entries([{ workerId: w.id, status: "PRESENT" }]) }))).ok).toBe(false);
  });

  it("site staff can only mark attendance on projects they work on", async () => {
    await loginAs("supervisor@dsc.demo");
    const p4 = await proj("PRJ-00004"); // supervisor isn't on this one
    const w = await db.worker.findFirstOrThrow({ where: { code: "W-00004" } });
    const d = new Date(Date.now() - 42 * 86400000).toISOString().slice(0, 10);
    expect((await markWorkerAttendance(fd({ projectId: p4.id, date: d, entries: entries([{ workerId: w.id, status: "PRESENT" }]) }))).ok).toBe(false);
  });

  it("labour cost flows into the project's profitability", async () => {
    const p1 = await proj("PRJ-00001");
    const f = (await projectFinancials(p1.companyId, [p1.id])).get(p1.id)!;
    const sum = await db.attendance.aggregate({ where: { projectId: p1.id }, _sum: { wageCost: true } });
    expect(f.labour).toBeGreaterThanOrEqual(Number(sum._sum.wageCost) - 0.01);
  });

  it("a worker marks themself present from their phone, once a day", async () => {
    const w = await db.worker.findFirstOrThrow({ where: { code: "W-00001" } });
    await db.attendance.deleteMany({ where: { workerId: w.id, date: dateOnly(new Date().toISOString().slice(0, 10)) } });
    await loginAs("w-00001@workers.local");
    const r1 = await checkIn(undefined, 19.2, 72.97);
    expect(r1.ok).toBe(true);
    const rec = await db.attendance.findFirstOrThrow({ where: { workerId: w.id }, orderBy: { date: "desc" } });
    expect(rec.method).toBe("LOCATION");
    expect(rec.status).toBe("PRESENT");
    expect(Number(rec.wageCost)).toBe(1100);
    const r2 = await checkIn();
    expect(r2.ok && r2.message).toMatch(/already/);
    expect(await db.attendance.count({ where: { workerId: w.id, date: rec.date } })).toBe(1);
  });

  it("only HR/managers can mark staff attendance", async () => {
    const emp = await db.employee.findFirstOrThrow({ where: { email: "sales@dsc.demo" } });
    const d = new Date(Date.now() - 43 * 86400000).toISOString().slice(0, 10);
    await loginAs("supervisor@dsc.demo");
    expect((await markEmployeeAttendance(fd({ date: d, entries: entries([{ employeeId: emp.id, status: "PRESENT" }]) }))).ok).toBe(false);
    await loginAs("hr@dsc.demo");
    expect((await markEmployeeAttendance(fd({ date: d, entries: entries([{ employeeId: emp.id, status: "PRESENT" }]) }))).ok).toBe(true);
    expect((await markEmployeeAttendance(fd({ date: d, entries: entries([{ employeeId: emp.id, status: "ABSENT" }]) }))).ok).toBe(true);
    expect(await db.attendance.count({ where: { employeeId: emp.id, date: dateOnly(d) } })).toBe(1);
  });
});

describe("contractors", () => {
  it("work order payments are capped at the agreed value and become project vendor cost", async () => {
    await loginAs("accounts@dsc.demo");
    const wo = await db.workOrder.findFirstOrThrow({ where: { number: "WO-00001" } }); // ₹86,400, ₹25,000 already paid
    const p2 = await proj("PRJ-00002");
    const before = (await projectFinancials(p2.companyId, [p2.id])).get(p2.id)!;
    expect((await recordContractorPayment(wo.contractorId, fd({ workOrderId: wo.id, amount: 70000, date: "2030-01-01" }))).ok).toBe(false); // would exceed
    expect((await recordContractorPayment(wo.contractorId, fd({ workOrderId: wo.id, amount: 30000, date: "2030-01-01", reference: "UTR1" }))).ok).toBe(true);
    const after = (await projectFinancials(p2.companyId, [p2.id])).get(p2.id)!;
    expect(after.vendor - before.vendor).toBe(30000);
  });

  it("only finance roles can record contractor payments; HR can manage contractors but not pay", async () => {
    const wo = await db.workOrder.findFirstOrThrow({ where: { number: "WO-00001" } });
    await loginAs("hr@dsc.demo");
    expect((await recordContractorPayment(wo.contractorId, fd({ amount: 100, date: "2030-01-01" }))).ok).toBe(false);
    const p1 = await proj("PRJ-00001");
    expect((await createWorkOrder(wo.contractorId, fd({ title: "New job", projectId: p1.id, amount: 5000 }))).ok).toBe(true);
  });
});

describe("leave", () => {
  it("employee applies → HR decides; nobody approves their own; overlaps are blocked", async () => {
    await loginAs("designer@dsc.demo");
    const from = new Date(Date.now() + 30 * 86400000);
    while (from.getDay() !== 1) from.setDate(from.getDate() + 1); // next Monday
    const to = new Date(from.getTime() + 2 * 86400000);
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);
    expect((await applyLeave(fd({ fromDate: t, toDate: f }))).ok).toBe(false); // reversed
    expect((await applyLeave(fd({ fromDate: f, toDate: t, reason: "Wedding", paid: "on" }))).ok).toBe(true);
    const leave = await db.leave.findFirstOrThrow({ where: { reason: "Wedding" } });
    expect(Number(leave.days)).toBe(3);
    expect(leave.status).toBe("PENDING");
    expect((await applyLeave(fd({ fromDate: f, toDate: f }))).ok).toBe(false); // overlap
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: leave.id, status: "PENDING" } });
    expect(ap.requiredRole).toBe("HR");
    expect((await approveRequest(ap.id)).ok).toBe(false); // designer has no approve permission
    await loginAs("hr@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(true);
    expect((await db.leave.findUniqueOrThrow({ where: { id: leave.id } })).status).toBe("APPROVED");
  });

  it("Sundays aren't counted as leave days; users can cancel only their own", async () => {
    await loginAs("store@dsc.demo");
    const from = new Date(Date.now() + 60 * 86400000);
    while (from.getDay() !== 5) from.setDate(from.getDate() + 1); // Friday
    const to = new Date(from.getTime() + 3 * 86400000); // Monday → Fri, Sat, Sun, Mon = 3 working days
    await applyLeave(fd({ fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10), reason: "Trip" }));
    const l = await db.leave.findFirstOrThrow({ where: { reason: "Trip" } });
    expect(Number(l.days)).toBe(3);
    await loginAs("sales@dsc.demo");
    expect((await cancelLeave(l.id)).ok).toBe(false);
    await loginAs("store@dsc.demo");
    expect((await cancelLeave(l.id)).ok).toBe(true);
    expect(await db.approval.count({ where: { entityId: l.id, status: "PENDING" } })).toBe(0);
  });
});

describe("payroll", () => {
  const lastMonth = () => { const n = new Date(); return n.getMonth() === 0 ? { m: 12, y: n.getFullYear() - 1 } : { m: n.getMonth(), y: n.getFullYear() }; };

  it("salary is hidden from non-HR roles", async () => {
    const e = await db.employee.findFirstOrThrow({ where: { email: "sales@dsc.demo" } });
    await loginAs("sales@dsc.demo");
    expect((await saveSalaryStructure(e.id, fd({ basic: 99999 }))).ok).toBe(false);
    expect((await runPayroll(fd({ month: 1, year: 2024 }))).ok).toBe(false);
    await loginAs("pm@dsc.demo");
    expect((await runPayroll(fd({ month: 1, year: 2024 }))).ok).toBe(false);
  });

  it("changing a salary is audited with old and new gross", async () => {
    await loginAs("hr@dsc.demo");
    const e = await db.employee.findFirstOrThrow({ where: { email: "sales@dsc.demo" } });
    const s = await db.salaryStructure.findUniqueOrThrow({ where: { employeeId: e.id } });
    expect((await saveSalaryStructure(e.id, fd({ basic: Number(s.basic) + 1000, hra: Number(s.hra), allowances: Number(s.allowances) }))).ok).toBe(true);
    const log = await db.auditLog.findFirst({ where: { entityType: "SalaryStructure", entityId: e.id }, orderBy: { createdAt: "desc" } });
    expect(log?.summary).toMatch(/changed from/);
  });

  it("runs payroll idempotently and keeps manually added bonus on re-run", async () => {
    await loginAs("hr@dsc.demo");
    const { m, y } = lastMonth();
    expect((await runPayroll(fd({ month: 12, year: new Date().getFullYear() + 1 }))).ok).toBe(false); // future
    const withStructure = await db.salaryStructure.count();
    expect((await runPayroll(fd({ month: m, year: y }))).ok).toBe(true);
    expect(await db.payslip.count({ where: { month: m, year: y } })).toBe(withStructure);
    const slip = await db.payslip.findFirstOrThrow({ where: { month: m, year: y } });
    const gross = Number(slip.basic) + Number(slip.hra) + Number(slip.allowances);
    expect((await adjustPayslip(slip.id, fd({ incentives: 1500, bonus: 2500 }))).ok).toBe(true);
    const adjusted = await db.payslip.findUniqueOrThrow({ where: { id: slip.id } });
    expect(Number(adjusted.netSalary)).toBeCloseTo(gross + 4000 - Number(slip.deductions) - Number(slip.leaveDeduction), 2);
    expect((await runPayroll(fd({ month: m, year: y }))).ok).toBe(true);
    expect(await db.payslip.count({ where: { month: m, year: y } })).toBe(withStructure); // no duplicates
    const again = await db.payslip.findUniqueOrThrow({ where: { id: slip.id } });
    expect(Number(again.bonus)).toBe(2500);
    expect(Number(again.netSalary)).toBeCloseTo(Number(adjusted.netSalary), 2);
  });
});

describe("employees", () => {
  it("onboards an employee with a sequential code; exiting disables their login", async () => {
    await loginAs("hr@dsc.demo");
    expect((await createEmployee(fd({ name: "" }))).ok).toBe(false);
    expect((await createEmployee(fd({ name: "New Joiner", designation: "Trainee", department: "Design", email: "nj@example.com" }))).ok).toBe(true);
    const e = await db.employee.findFirstOrThrow({ where: { name: "New Joiner" } });
    expect(e.code).toMatch(/^EMP-\d{3}$/);
    const store = await db.employee.findFirstOrThrow({ where: { email: "store@dsc.demo" } });
    expect((await setEmployeeStatus(store.id, "EXITED")).ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: store.userId! } })).isActive).toBe(false);
    // the ex-employee can no longer act
    logout();
    expect((await setEmployeeStatus(store.id, "ACTIVE")).ok).toBe(false); // logged out
    await loginAs("hr@dsc.demo");
    expect((await setEmployeeStatus(store.id, "ACTIVE")).ok).toBe(true);
  });
});
