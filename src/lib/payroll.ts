import { round2 } from "./utils";

/**
 * Payroll rules are CONFIGURATION (Company Settings → payrollConfig), never hard-coded statute.
 * Defaults are neutral: no PF / professional tax unless the company configures them.
 */
export type PayrollConfig = {
  workingDays: number; // days used to pro-rate a month (e.g. 26)
  useAttendance: boolean; // deduct for absences found in attendance records
  paidLeavesPerMonth: number; // approved paid leave days that don't reduce pay
  overtimeMultiplier: number; // e.g. 1.5 × hourly rate
  hoursPerDay: number;
  pfPercent: number; // % of basic withheld as provident fund (0 = off)
  fixedDeduction: number; // flat monthly deduction (e.g. professional tax) (0 = off)
};

export const DEFAULT_PAYROLL: PayrollConfig = { workingDays: 26, useAttendance: false, paidLeavesPerMonth: 1, overtimeMultiplier: 1.5, hoursPerDay: 8, pfPercent: 0, fixedDeduction: 0 };

export function readPayrollConfig(json: unknown): PayrollConfig {
  const j = (json && typeof json === "object" ? json : {}) as Partial<PayrollConfig>;
  const n = (v: unknown, d: number, min = 0) => (typeof v === "number" && Number.isFinite(v) && v >= min ? v : d);
  return {
    workingDays: n(j.workingDays, DEFAULT_PAYROLL.workingDays, 1),
    useAttendance: typeof j.useAttendance === "boolean" ? j.useAttendance : DEFAULT_PAYROLL.useAttendance,
    paidLeavesPerMonth: n(j.paidLeavesPerMonth, DEFAULT_PAYROLL.paidLeavesPerMonth),
    overtimeMultiplier: n(j.overtimeMultiplier, DEFAULT_PAYROLL.overtimeMultiplier),
    hoursPerDay: n(j.hoursPerDay, DEFAULT_PAYROLL.hoursPerDay, 1),
    pfPercent: n(j.pfPercent, 0),
    fixedDeduction: n(j.fixedDeduction, 0),
  };
}

export type PayslipInput = {
  basic: number;
  hra: number;
  allowances: number;
  structureDeductions: number; // fixed deductions on the salary structure
  config: PayrollConfig;
  paidLeaveDays: number; // approved paid leave days falling in the month
  unpaidLeaveDays: number; // approved unpaid leave days in the month
  absentDays: number; // from attendance (only used when config.useAttendance)
  overtimeHours: number;
  incentives?: number;
  bonus?: number;
};

export type PayslipResult = {
  gross: number;
  perDay: number;
  presentDays: number;
  overtime: number;
  leaveDeduction: number;
  statutoryDeductions: number; // PF + fixed
  deductions: number; // total deductions shown (structure + statutory)
  netSalary: number;
};

export function computePayslip(i: PayslipInput): PayslipResult {
  const c = i.config;
  const gross = i.basic + i.hra + i.allowances;
  const perDay = gross / c.workingDays;
  // Paid leave is covered up to the monthly allowance; the rest is unpaid.
  const coveredPaid = Math.min(i.paidLeaveDays, c.paidLeavesPerMonth);
  const unpaidDays = i.unpaidLeaveDays + (i.paidLeaveDays - coveredPaid) + (c.useAttendance ? Math.max(0, i.absentDays) : 0);
  const unpaid = Math.min(unpaidDays, c.workingDays);
  const leaveDeduction = round2(unpaid * perDay);
  const overtime = round2(i.overtimeHours * (perDay / c.hoursPerDay) * c.overtimeMultiplier);
  const pf = round2((i.basic * c.pfPercent) / 100);
  const statutory = round2(pf + c.fixedDeduction);
  const deductions = round2(i.structureDeductions + statutory);
  const net = round2(gross + overtime + (i.incentives ?? 0) + (i.bonus ?? 0) - deductions - leaveDeduction);
  return { gross: round2(gross), perDay: round2(perDay), presentDays: round2(c.workingDays - unpaid), overtime, leaveDeduction, statutoryDeductions: statutory, deductions, netSalary: Math.max(0, net) };
}

export type WageWorker = { wageType: "DAILY" | "MONTHLY" | "CONTRACT"; dailyWage: number; monthlyWage: number };

export function dailyRate(w: WageWorker, workingDays = DEFAULT_PAYROLL.workingDays) {
  if (w.wageType === "DAILY") return w.dailyWage;
  if (w.wageType === "MONTHLY") return w.monthlyWage / workingDays;
  return 0; // CONTRACT workers are paid through their contractor
}

/** Wage cost for one worker-day. Snapshotted on the attendance row so later wage changes don't rewrite history. */
export function dayWageCost(w: WageWorker, status: "PRESENT" | "ABSENT" | "HALF_DAY" | "LEAVE" | "OVERTIME", overtimeHours = 0, cfg: PayrollConfig = DEFAULT_PAYROLL) {
  const rate = dailyRate(w, cfg.workingDays);
  const base = status === "PRESENT" || status === "OVERTIME" ? 1 : status === "HALF_DAY" ? 0.5 : 0;
  const ot = status === "ABSENT" || status === "LEAVE" ? 0 : overtimeHours * (rate / cfg.hoursPerDay) * cfg.overtimeMultiplier;
  return round2(base * rate + ot);
}

/** Days of [from, to] that fall inside a calendar month. */
export function leaveDaysInMonth(from: Date, to: Date, year: number, month: number): number {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const a = new Date(Math.max(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()), start.getTime()));
  const b = new Date(Math.min(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()), end.getTime()));
  if (b < a) return 0;
  let days = 0;
  for (let d = new Date(a); d <= b; d = new Date(d.getTime() + 86400000)) if (d.getUTCDay() !== 0) days++; // Sundays aren't leave days
  return days;
}
