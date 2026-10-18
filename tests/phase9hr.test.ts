import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { applyLeave, giveAdvance, runPayroll, writeOffAdvance } from "@/app/(app)/hr/actions";
import { approveRequest } from "@/app/(app)/approvals/actions";
import { importFile } from "@/app/(app)/settings/import/actions";
import { DEFAULT_LEAVE_POLICY, evaluateLeave } from "@/lib/leave-policy";
import { balanceOf } from "@/lib/advances";

beforeEach(() => logout());

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAhead = (n: number) => iso(new Date(Date.now() + n * 86400000));
/** the nearest Monday on or after n days ahead, so a 1–3 day range has no Sunday in it */
const monday = (n: number) => { const d = new Date(Date.now() + n * 86400000); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d; };

describe("leave policy rules", () => {
  const p = DEFAULT_LEAVE_POLICY;
  it("regular leave needs 15 days' notice; more than 3 days becomes long leave needing 3 months", () => {
    expect(evaluateLeave({ kind: "REGULAR", days: 2, noticeDays: 5, usedThisYear: 0, policy: p }).error).toMatch(/15 days/);
    expect(evaluateLeave({ kind: "REGULAR", days: 2, noticeDays: 15, usedThisYear: 0, policy: p })).toMatchObject({ kind: "REGULAR", error: null, requiredRole: "HR" });
    const long = evaluateLeave({ kind: "REGULAR", days: 5, noticeDays: 40, usedThisYear: 0, policy: p });
    expect(long.kind).toBe("LONG");
    expect(long.error).toMatch(/3 months/);
    expect(evaluateLeave({ kind: "LONG", days: 2, noticeDays: 91, usedThisYear: 0, policy: p })).toMatchObject({ kind: "LONG", error: null, requiredRole: "MANAGEMENT" });
  });
  it("medical and emergency leave need no notice, but must be reported within a week", () => {
    expect(evaluateLeave({ kind: "MEDICAL", days: 3, noticeDays: 0, usedThisYear: 0, policy: p })).toMatchObject({ error: null, requiredRole: "HR" });
    expect(evaluateLeave({ kind: "EMERGENCY", days: 1, noticeDays: -3, usedThisYear: 0, policy: p }).error).toBeNull();
    expect(evaluateLeave({ kind: "EMERGENCY", days: 1, noticeDays: -9, usedThisYear: 0, policy: p }).error).toMatch(/within 7 days/);
  });
  it("beyond 30 days in a year needs the Managing Director", () => {
    const v = evaluateLeave({ kind: "MEDICAL", days: 5, noticeDays: 0, usedThisYear: 27, policy: p });
    expect(v.exceedsCap).toBe(true);
    expect(v.requiredRole).toBe("OWNER");
    expect(v.note).toMatch(/Managing Director/);
    expect(evaluateLeave({ kind: "MEDICAL", days: 3, noticeDays: 0, usedThisYear: 27, policy: p }).exceedsCap).toBe(false);
  });
});

describe("applying for leave under the policy", () => {
  it("is refused without enough notice, and goes to the right approver when allowed", async () => {
    await loginAs("designer@dsc.demo");
    const soon = monday(5);
    const refused = await applyLeave(fd({ fromDate: iso(soon), toDate: iso(soon), reason: "Personal", kind: "REGULAR" }));
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toMatch(/15 days/);

    const later = monday(40);
    expect((await applyLeave(fd({ fromDate: iso(later), toDate: iso(later), reason: "Family work", kind: "REGULAR" }))).ok).toBe(true);
    const l1 = await db.leave.findFirstOrThrow({ where: { reason: "Family work" } });
    expect(l1.kind).toBe("REGULAR");
    expect((await db.approval.findFirstOrThrow({ where: { entityId: l1.id } })).requiredRole).toBe("HR");

    // 4 days at 40 days' notice = long leave: refused; at 120 days' notice it needs Management
    const f = monday(45), t = new Date(f.getTime() + 3 * 86400000);
    expect((await applyLeave(fd({ fromDate: iso(f), toDate: iso(t), reason: "Wedding trip", kind: "REGULAR" }))).ok).toBe(false);
    const f2 = monday(120), t2 = new Date(f2.getTime() + 3 * 86400000);
    expect((await applyLeave(fd({ fromDate: iso(f2), toDate: iso(t2), reason: "Festival at home", kind: "LONG" }))).ok).toBe(true);
    const l2 = await db.leave.findFirstOrThrow({ where: { reason: "Festival at home" } });
    expect(l2.kind).toBe("LONG");
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: l2.id } });
    expect(ap.requiredRole).toBe("MANAGEMENT");
    await loginAs("hr@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(false); // HR alone can't approve long leave
    await loginAs("director@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(true);
  });

  it("medical leave: no notice but a reason; reporting more than a week late is refused", async () => {
    await loginAs("store@dsc.demo");
    // a working day (Sundays carry no leave days)
    const day = new Date(); if (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
    const today = iso(day);
    expect((await applyLeave(fd({ fromDate: today, toDate: today, kind: "MEDICAL" }))).ok).toBe(false); // reason needed
    expect((await applyLeave(fd({ fromDate: today, toDate: today, kind: "MEDICAL", reason: "Fever" }))).ok).toBe(true);
    expect((await applyLeave(fd({ fromDate: daysAhead(-20), toDate: daysAhead(-20), kind: "EMERGENCY", reason: "Late report" }))).ok).toBe(false);
  });

  it("beyond the 30-day yearly limit needs the Managing Director's approval", async () => {
    const u = await db.user.findFirstOrThrow({ where: { email: "engineer@dsc.demo" } });
    const emp = await db.employee.findFirstOrThrow({ where: { userId: u.id } });
    const company = await db.company.findFirstOrThrow();
    await db.leave.create({ data: { companyId: company.id, employeeId: emp.id, fromDate: new Date("2033-02-01T00:00:00Z"), toDate: new Date("2033-03-12T00:00:00Z"), days: 29, status: "APPROVED", reason: "Earlier leave" } });
    await loginAs("engineer@dsc.demo");
    const d = new Date("2033-09-05T00:00:00Z"); // a Monday far ahead, so notice is no problem
    expect((await applyLeave(fd({ fromDate: iso(d), toDate: iso(new Date(d.getTime() + 2 * 86400000)), reason: "Extra", kind: "REGULAR" }))).ok).toBe(true);
    const leave = await db.leave.findFirstOrThrow({ where: { employeeId: emp.id, reason: "Extra" } });
    expect(leave.exceedsCap).toBe(true);
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: leave.id } });
    expect(ap.requiredRole).toBe("OWNER");
    await loginAs("hr@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(false);
    await loginAs("director@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(false);
    await loginAs("owner@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(true);
  });
});

describe("employee advances are recovered through payroll", () => {
  const ids: string[] = [];
  afterAll(async () => {
    await db.employeeAdvance.updateMany({ where: { id: { in: ids } }, data: { status: "WRITTEN_OFF" } });
  });

  it("recovers in instalments, never twice for the same month, and closes when repaid", async () => {
    const emp = await db.employee.findFirstOrThrow({ where: { salaryStructure: { isNot: null }, status: { not: "EXITED" } } });
    const now = new Date();
    const back = (m: number) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1)); return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), first: iso(d) }; };
    const m2 = back(2), m1 = back(1), m0 = back(0);

    await loginAs("hr@dsc.demo");
    const run = async (p: { month: number; year: number }) => { expect((await runPayroll(fd({ month: p.month, year: p.year }))).ok).toBe(true); return db.payslip.findFirstOrThrow({ where: { employeeId: emp.id, month: p.month, year: p.year } }); };
    const base = await run(m2);
    expect((await giveAdvance(fd({ employeeId: emp.id, amount: 70000, monthlyRecovery: 30000, givenOn: m2.first, reason: "Medical" }))).ok).toBe(true);
    const adv = await db.employeeAdvance.findFirstOrThrow({ where: { employeeId: emp.id }, orderBy: { createdAt: "desc" } });
    ids.push(adv.id);

    const a = await run(m2);
    expect(Number(a.advanceRecovery)).toBe(30000);
    expect(Number(a.deductions) - Number(base.deductions)).toBe(30000);
    expect(Number(base.netSalary) - Number(a.netSalary)).toBeCloseTo(Math.min(30000, Number(base.netSalary)), 2);
    await run(m2); // re-running changes nothing
    expect(await db.advanceRecovery.count({ where: { advanceId: adv.id } })).toBe(1);

    expect(Number((await run(m1)).advanceRecovery)).toBe(30000);
    expect(Number((await run(m0)).advanceRecovery)).toBe(10000); // what was left
    const done = await db.employeeAdvance.findUniqueOrThrow({ where: { id: adv.id }, include: { recoveries: true } });
    expect(done.status).toBe("CLEARED");
    expect(balanceOf(done)).toBe(0);
    expect(Number((await run(m0)).advanceRecovery)).toBe(10000); // still the same, not zero and not doubled
  });

  it("validates and restricts who can give or write off an advance", async () => {
    const emp = await db.employee.findFirstOrThrow({ where: { salaryStructure: { isNot: null } } });
    await loginAs("sales@dsc.demo");
    expect((await giveAdvance(fd({ employeeId: emp.id, amount: 1000, monthlyRecovery: 500 }))).ok).toBe(false);
    await loginAs("hr@dsc.demo");
    expect((await giveAdvance(fd({ employeeId: emp.id, amount: 1000, monthlyRecovery: 5000 }))).ok).toBe(false); // instalment > advance
    expect((await giveAdvance(fd({ employeeId: emp.id, amount: 0, monthlyRecovery: 100 }))).ok).toBe(false);
    expect((await giveAdvance(fd({ employeeId: emp.id, amount: 5000, monthlyRecovery: 1000 }))).ok).toBe(true);
    const a = await db.employeeAdvance.findFirstOrThrow({ where: { employeeId: emp.id, amount: 5000 } });
    ids.push(a.id);
    expect((await writeOffAdvance(a.id, fd({ note: "Left the company" }))).ok).toBe(false); // HR can't write off
    await loginAs("director@dsc.demo");
    expect((await writeOffAdvance(a.id, fd({}))).ok).toBe(false); // reason needed
    expect((await writeOffAdvance(a.id, fd({ note: "Left the company" }))).ok).toBe(true);
    expect((await db.employeeAdvance.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("WRITTEN_OFF");
  });
});

describe("importing the employee list from Keka", () => {
  it("understands Keka's column names, its employee numbers and its date format", async () => {
    await loginAs("admin@dsc.demo");
    const text = [
      "Display Name,Employee Number,Email,Mobile Number,Department,Job Title,Location,Date Joined (dd-mmm-yyyy)",
      "Keka Person One,DSC901,keka1@example.com,98100 40001,Projects,Site Supervisor,Mumbai,03-Jun-2024",
      "Keka Person Two,DSC902,keka2@example.com,98100 40002,Accounts,Accountant,Virar,15-Jan-2023",
    ].join("\r\n");
    const send = (mode: "check" | "import") => { const f = new FormData(); f.set("entity", "employees"); f.set("mode", mode); f.set("file", new File([text], "keka.csv")); return importFile(f); };
    const chk = await send("check");
    expect(chk.ok && chk.data?.valid).toBe(2);
    expect((await send("import")).ok).toBe(true);
    const e = await db.employee.findFirstOrThrow({ where: { code: "DSC901" } });
    expect(e).toMatchObject({ name: "Keka Person One", designation: "Site Supervisor", department: "Projects", workLocation: "Mumbai", email: "keka1@example.com" });
    expect(e.joiningDate?.toISOString().slice(0, 10)).toBe("2024-06-03");
    expect((await db.employee.findFirstOrThrow({ where: { code: "DSC902" } })).joiningDate?.toISOString().slice(0, 10)).toBe("2023-01-15");
    const again = await send("import"); // re-uploading skips people already there
    expect(again.ok && again.data?.created).toBe(0);
    expect(again.ok && again.data?.duplicates).toBe(2);
  });
});
