import type { PrismaClient, WorkerTrade, WageType, AttendanceStatus } from "@prisma/client";
import type { CoreSeed } from "./core";
import type { ProjectSeed } from "./projects";
import { computePayslip, dayWageCost, DEFAULT_PAYROLL, leaveDaysInMonth } from "../../src/lib/payroll";
import { calendarDay } from "../../src/lib/utils";

const day = (offset: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

const WORKERS: [string, WorkerTrade, WageType, number, number, number | null][] = [
  // name, trade, wageType, daily, monthly, site index (0/1/null)
  ["Ramesh Yadav", "CARPENTER", "DAILY", 1100, 0, 0], ["Sunil Pawar", "CARPENTER", "DAILY", 1000, 0, 0], ["Dilip Chauhan", "CARPENTER", "DAILY", 950, 0, 0],
  ["Mohan Singh", "ELECTRICIAN", "DAILY", 1050, 0, 0], ["Anwar Shaikh", "ELECTRICIAN", "DAILY", 950, 0, 1], ["Prakash More", "PLUMBER", "DAILY", 900, 0, 0],
  ["Santosh Kamble", "PAINTER", "DAILY", 800, 0, 0], ["Vijay Jadhav", "PAINTER", "DAILY", 800, 0, 0], ["Ganesh Thakur", "FALSE_CEILING", "DAILY", 950, 0, 0],
  ["Rajesh Kumar", "HELPER", "DAILY", 600, 0, 0], ["Bablu Das", "HELPER", "DAILY", 600, 0, 0], ["Imran Ansari", "FABRICATOR", "DAILY", 1100, 0, 1],
  ["Deepak Gupta", "INSTALLER", "DAILY", 900, 0, 1], ["Sohail Khan", "INSTALLER", "DAILY", 900, 0, 1], ["Manoj Tiwari", "HELPER", "DAILY", 600, 0, 1],
  ["Kailash Meena", "CIVIL", "MONTHLY", 0, 22000, 1], ["Rafiq Sayyed", "CIVIL", "MONTHLY", 0, 20000, null], ["Pintu Roy", "CIVIL", "CONTRACT", 0, 0, 1],
  ["Lalit Verma", "CIVIL", "CONTRACT", 0, 0, 1], ["Nilesh Patil", "OTHER", "DAILY", 700, 0, null],
];

export async function seedWorkforce(prisma: PrismaClient, core: CoreSeed, proj: ProjectSeed, passwordHash: string) {
  const { companyId } = core;
  if ((await prisma.worker.count({ where: { companyId } })) > 0) return;
  const projects = await prisma.project.findMany({ where: { id: { in: proj.projectIds } }, orderBy: { code: "asc" } });
  const hr = core.users.find((u) => u.role === "HR")!;
  const supervisor = core.users.find((u) => u.role === "SITE_SUPERVISOR")!;

  const tile = await prisma.contractor.create({ data: { companyId, name: "Shree Ganesh Tile Works", contactPerson: "Ganesh Pujari", phone: "+91 98221 40001", rating: 4, notes: "Tiling and flooring specialists" } });
  const civil = await prisma.contractor.create({ data: { companyId, name: "Om Sai Civil Contractors", contactPerson: "Sai Prasad", phone: "+91 98221 40002", rating: 3, notes: "Masonry, plaster, waterproofing" } });

  const workers = [];
  for (let i = 0; i < WORKERS.length; i++) {
    const [name, trade, wageType, dailyWage, monthlyWage, site] = WORKERS[i];
    workers.push(await prisma.worker.create({
      data: {
        companyId, code: `W-${String(i + 1).padStart(5, "0")}`, name, trade, wageType, dailyWage, monthlyWage, phone: `+91 98${String(10000000 + i * 7919).slice(0, 8)}`,
        contractorId: wageType === "CONTRACT" ? civil.id : null, currentProjectId: site === null ? null : projects[site].id, joiningDate: day(-400 + i * 9), emergencyContact: "Family member – +91 90000 00000",
      },
    }));
  }
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "W" } }, update: { value: workers.length }, create: { companyId, key: "W", value: workers.length } });

  // a phone login for the first worker
  await prisma.user.create({ data: { companyId, email: "w-00001@workers.local", name: workers[0].name, role: "WORKER", workerId: workers[0].id, passwordHash } });

  // attendance: last 14 days (no Sundays), with a realistic spread
  for (let back = 14; back >= 0; back--) {
    const local = day(-back);
    if (local.getDay() === 0) continue;
    const date = calendarDay(local);
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      if (!w.currentProjectId) continue;
      if (back === 0 && i % 3 === 0) continue; // today: some haven't been marked yet
      const roll = (i * 7 + back * 3) % 17;
      const status: AttendanceStatus = roll === 0 ? "ABSENT" : roll === 1 ? "HALF_DAY" : roll === 2 ? "LEAVE" : "PRESENT";
      const ot = status === "PRESENT" && (i + back) % 6 === 0 ? 2 : 0;
      const final: AttendanceStatus = ot ? "OVERTIME" : status;
      await prisma.attendance.create({
        data: { companyId, date, workerId: w.id, projectId: w.currentProjectId, status: final, method: back === 0 && i === 0 ? "MOBILE" : "MANUAL", overtimeHrs: ot, wageCost: dayWageCost({ wageType: w.wageType, dailyWage: Number(w.dailyWage), monthlyWage: Number(w.monthlyWage) }, final, ot), markedById: supervisor.id },
      });
    }
  }

  // staff attendance for the last few days
  const emps = await prisma.employee.findMany({ where: { companyId } });
  for (let back = 4; back >= 0; back--) {
    const local = day(-back);
    if (local.getDay() === 0) continue;
    const date = calendarDay(local);
    for (let i = 0; i < emps.length; i++) {
      await prisma.attendance.create({ data: { companyId, date, employeeId: emps[i].id, status: (i + back) % 11 === 0 ? "ABSENT" : "PRESENT", method: "MANUAL", wageCost: 0, markedById: hr.id } });
    }
  }

  // work orders + a payment (counts as project cost)
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "WO" } }, update: { value: 2 }, create: { companyId, key: "WO", value: 2 } });
  const wo1 = await prisma.workOrder.create({ data: { companyId, number: "WO-00001", contractorId: tile.id, projectId: projects[1].id, title: "Epoxy & tile flooring – retail store", rateNote: "₹48/sq ft incl. labour", amount: 86400, status: "OPEN", startDate: day(5), endDate: day(25) } });
  await prisma.workOrder.create({ data: { companyId, number: "WO-00002", contractorId: civil.id, projectId: projects[0].id, title: "Masonry & plaster – flat modifications", amount: 140000, status: "COMPLETED", startDate: day(-45), endDate: day(-28) } });
  await prisma.contractorPayment.create({ data: { companyId, contractorId: civil.id, workOrderId: (await prisma.workOrder.findFirstOrThrow({ where: { number: "WO-00002" } })).id, projectId: projects[0].id, date: day(-26), amount: 140000, method: "BANK_TRANSFER", reference: "UTR881920331" } });
  await prisma.contractorPayment.create({ data: { companyId, contractorId: tile.id, workOrderId: wo1.id, projectId: projects[1].id, date: day(-2), amount: 25000, method: "UPI", reference: "UPI-5521", notes: "Advance" } });

  // leaves
  const pm2 = emps.find((e) => e.email === "pm2@dsc.demo");
  const sales2 = emps.find((e) => e.email === "sales2@dsc.demo");
  if (pm2) await prisma.leave.create({ data: { companyId, employeeId: pm2.id, fromDate: day(8), toDate: day(10), days: 3, reason: "Family function", status: "APPROVED", decidedById: hr.id } });
  if (sales2) {
    const l = await prisma.leave.create({ data: { companyId, employeeId: sales2.id, fromDate: day(14), toDate: day(15), days: 2, reason: "Personal work", status: "PENDING" } });
    await prisma.approval.create({ data: { companyId, type: "LEAVE", entityType: "Leave", entityId: l.id, title: `Leave – ${sales2.name}, 2 day(s)`, amount: 0, requestedById: sales2.userId!, requiredRole: "HR", steps: { create: { stepNo: 1, role: "HR" } } } });
  }

  await prisma.announcement.create({ data: { companyId, title: "Site safety reminder", body: "Helmets and safety shoes are mandatory on every site from Monday. Supervisors: please confirm PPE at the start of each shift.", pinned: true, createdById: hr.id } });
  await prisma.announcement.create({ data: { companyId, title: "Office closed on Diwali", body: "The office will be closed for Diwali. Site work continues as per the project plan.", createdById: hr.id } });

  // last month's payroll
  const now = new Date();
  const pm = now.getMonth() === 0 ? 12 : now.getMonth();
  const py = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const structures = await prisma.salaryStructure.findMany({ where: { companyId } });
  const leaves = await prisma.leave.findMany({ where: { companyId, status: "APPROVED" } });
  for (const s of structures) {
    const l = leaves.filter((x) => x.employeeId === s.employeeId);
    const r = computePayslip({ basic: Number(s.basic), hra: Number(s.hra), allowances: Number(s.allowances), structureDeductions: Number(s.deductions), config: DEFAULT_PAYROLL, paidLeaveDays: l.filter((x) => x.paid).reduce((a, x) => a + leaveDaysInMonth(x.fromDate, x.toDate, py, pm), 0), unpaidLeaveDays: 0, absentDays: 0, overtimeHours: 0 });
    await prisma.payslip.create({ data: { companyId, employeeId: s.employeeId, month: pm, year: py, workingDays: DEFAULT_PAYROLL.workingDays, presentDays: r.presentDays, basic: s.basic, hra: s.hra, allowances: s.allowances, overtime: r.overtime, deductions: r.deductions, leaveDeduction: r.leaveDeduction, netSalary: r.netSalary } });
  }
}
