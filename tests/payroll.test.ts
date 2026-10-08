import { describe, it, expect } from "vitest";
import { computePayslip, DEFAULT_PAYROLL, dayWageCost, dailyRate, leaveDaysInMonth, readPayrollConfig } from "@/lib/payroll";

const base = { basic: 26000, hra: 13000, allowances: 13000, structureDeductions: 0, config: DEFAULT_PAYROLL, paidLeaveDays: 0, unpaidLeaveDays: 0, absentDays: 0, overtimeHours: 0 };

describe("computePayslip", () => {
  it("pays gross when there is nothing to adjust", () => {
    const r = computePayslip(base);
    expect(r.gross).toBe(52000);
    expect(r.perDay).toBe(2000);
    expect(r.netSalary).toBe(52000);
  });

  it("deducts unpaid leave per day of gross", () => {
    expect(computePayslip({ ...base, unpaidLeaveDays: 2 }).leaveDeduction).toBe(4000);
    expect(computePayslip({ ...base, unpaidLeaveDays: 2 }).netSalary).toBe(48000);
  });

  it("covers paid leave up to the monthly allowance and deducts the excess", () => {
    expect(computePayslip({ ...base, paidLeaveDays: 1 }).leaveDeduction).toBe(0);
    expect(computePayslip({ ...base, paidLeaveDays: 3 }).leaveDeduction).toBe(4000); // 1 covered, 2 unpaid
  });

  it("ignores absences unless attendance is switched on", () => {
    expect(computePayslip({ ...base, absentDays: 3 }).leaveDeduction).toBe(0);
    expect(computePayslip({ ...base, absentDays: 3, config: { ...DEFAULT_PAYROLL, useAttendance: true } }).leaveDeduction).toBe(6000);
  });

  it("adds overtime at the configured multiplier, plus incentives and bonus", () => {
    const r = computePayslip({ ...base, overtimeHours: 8, incentives: 1000, bonus: 2500 });
    expect(r.overtime).toBe(3000); // 8h × (2000/8) × 1.5
    expect(r.netSalary).toBe(52000 + 3000 + 1000 + 2500);
  });

  it("statutory deductions are configuration, off by default", () => {
    expect(computePayslip(base).statutoryDeductions).toBe(0);
    const r = computePayslip({ ...base, config: { ...DEFAULT_PAYROLL, pfPercent: 12, fixedDeduction: 200 } });
    expect(r.statutoryDeductions).toBe(3320); // 12% of 26000 + 200
    expect(r.netSalary).toBe(52000 - 3320);
  });

  it("never produces a negative salary or deducts more than a month", () => {
    const r = computePayslip({ ...base, unpaidLeaveDays: 90, structureDeductions: 100000 });
    expect(r.netSalary).toBe(0);
    expect(r.leaveDeduction).toBe(52000);
  });
});

describe("worker wages", () => {
  const daily = { wageType: "DAILY" as const, dailyWage: 800, monthlyWage: 0 };
  it("full day, half day, absent", () => {
    expect(dayWageCost(daily, "PRESENT")).toBe(800);
    expect(dayWageCost(daily, "HALF_DAY")).toBe(400);
    expect(dayWageCost(daily, "ABSENT", 3)).toBe(0);
    expect(dayWageCost(daily, "LEAVE")).toBe(0);
  });
  it("overtime is paid per hour at 1.5×", () => {
    expect(dayWageCost(daily, "OVERTIME", 4)).toBe(800 + 4 * 100 * 1.5);
  });
  it("monthly workers are pro-rated; contract workers cost nothing here", () => {
    expect(dailyRate({ wageType: "MONTHLY", dailyWage: 0, monthlyWage: 26000 })).toBe(1000);
    expect(dayWageCost({ wageType: "CONTRACT", dailyWage: 900, monthlyWage: 0 }, "PRESENT")).toBe(0);
  });
});

describe("helpers", () => {
  it("counts leave days inside a month and skips Sundays", () => {
    // Oct 2030: 28 Oct is Monday; leave Fri 25 Oct – Wed 6 Nov
    expect(leaveDaysInMonth(new Date("2030-10-25"), new Date("2030-11-06"), 2030, 10)).toBe(6); // 25,26,28,29,30,31 (27 is Sunday)
    expect(leaveDaysInMonth(new Date("2030-10-25"), new Date("2030-11-06"), 2030, 11)).toBe(5); // 1,2,4,5,6 (3 is Sunday)
    expect(leaveDaysInMonth(new Date("2030-10-25"), new Date("2030-11-06"), 2030, 12)).toBe(0);
  });
  it("falls back to defaults for missing or invalid config", () => {
    expect(readPayrollConfig(null)).toEqual(DEFAULT_PAYROLL);
    expect(readPayrollConfig({ workingDays: -5, pfPercent: "x" }).workingDays).toBe(26);
    expect(readPayrollConfig({ pfPercent: 12 }).pfPercent).toBe(12);
  });
});
