import type { ExpenseCategory, InvoiceStatus, PaymentMethod, PrismaClient } from "@prisma/client";
import type { CoreSeed } from "./core";
import type { ProjectSeed } from "./projects";
import { computeTotals } from "../../src/lib/money";

const day = (offset: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

export async function seedFinance(prisma: PrismaClient, core: CoreSeed, proj: ProjectSeed) {
  const { companyId } = core;
  if ((await prisma.invoice.count({ where: { companyId } })) > 0) return;
  const projects = await prisma.project.findMany({ where: { id: { in: proj.projectIds } }, orderBy: { code: "asc" } });
  const accounts = core.users.find((u) => u.role === "ACCOUNTS")!;
  const engineer = core.users.find((u) => u.role === "SITE_ENGINEER")!;

  let invNo = 0;
  // project index, label, pct of contract, issue offset, due offset, paid fraction, status
  const defs: [number, string, number, number, number, number, InvoiceStatus][] = [
    [0, "Advance / mobilisation – 30%", 30, -44, -29, 1, "PAID"],
    [0, "Carcass & civil complete – 30%", 30, -20, -5, 0.5, "PARTIALLY_PAID"],
    [1, "Advance / mobilisation – 30%", 30, -9, 6, 0, "SENT"],
    [4, "Final settlement – 100%", 100, -45, -30, 1, "PAID"],
    [2, "Design advance – 10%", 10, -3, -1, 0, "OVERDUE"],
    [3, "Advance – 20%", 20, -1, 14, 0, "DRAFT"],
  ];
  for (const [pi, label, pct, issue, due, paidFrac, status] of defs) {
    invNo++;
    const p = projects[pi];
    const amount = Math.round((Number(p.contractValue) * pct) / 100);
    const t = computeTotals([{ quantity: 1, rate: amount, taxPercent: 18 }]);
    const paid = Math.round(t.total * paidFrac * 100) / 100;
    const inv = await prisma.invoice.create({
      data: {
        companyId, number: `INV-${String(invNo).padStart(5, "0")}`, clientId: p.clientId, projectId: p.id, quotationId: p.quotationId, issueDate: day(issue), dueDate: day(due), status,
        paymentTerms: "Payable within 15 days", subtotal: t.subtotal, taxAmount: t.tax, total: t.total, paid,
        items: { create: { description: `${label} – ${p.name}`, unit: "lumpsum", quantity: 1, rate: amount, taxPercent: 18, amount: t.lines[0].amount } },
      },
    });
    if (paid > 0) {
      const methods: PaymentMethod[] = ["BANK_TRANSFER", "UPI", "CHEQUE"];
      await prisma.payment.create({ data: { companyId, invoiceId: inv.id, amount: paid, date: day(issue + 9), method: methods[invNo % 3], reference: `REF${900000 + invNo * 137}` } });
    }
  }
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "INV" } }, update: { value: invNo }, create: { companyId, key: "INV", value: invNo } });

  // vendor bills: link to the seeded POs (material) + a service bill for a project
  const pos = await prisma.purchaseOrder.findMany({ where: { companyId, status: { in: ["RECEIVED", "PARTIALLY_RECEIVED"] } }, include: { vendor: true }, orderBy: { number: "asc" } });
  let billNo = 0;
  for (const po of pos) {
    billNo++;
    const amount = Math.round(Number(po.total) * (po.status === "RECEIVED" ? 1 : 0.5));
    const paid = po.status === "RECEIVED" ? amount : 0;
    const bill = await prisma.vendorBill.create({ data: { companyId, number: `${po.vendor.name.slice(0, 3).toUpperCase()}/${2600 + billNo}`, vendorId: po.vendorId, poId: po.id, projectId: po.projectId, billDate: day(-22 + billNo * 6), dueDate: day(-2 + billNo * 6), amount, paid, status: paid >= amount ? "PAID" : "UNPAID" } });
    if (paid > 0) await prisma.vendorPayment.create({ data: { companyId, vendorId: po.vendorId, billId: bill.id, amount: paid, date: day(-12), method: "BANK_TRANSFER", reference: "NEFT445521" } });
  }
  const vendor = await prisma.vendor.findFirstOrThrow({ where: { companyId, name: { startsWith: "Havells" } } });
  await prisma.vendorBill.create({ data: { companyId, number: "SVC/118", vendorId: vendor.id, projectId: projects[0].id, billDate: day(-15), dueDate: day(-3), amount: 42500, notes: "Electrical sub-contract labour – 3BHK" } });

  // expenses
  const exp: [number | null, ExpenseCategory, string, number, number, boolean, string][] = [
    [0, "PROJECT", "Site tea, water & tools", 3200, -6, true, "Petty cash"], [0, "TRAVEL", "Material pickup – tempo hire", 4800, -9, true, "Mahesh Gaikwad"],
    [1, "PROJECT", "Site survey photography", 6500, -4, true, "Tushar Bhosale"], [null, "OFFICE", "Office stationery & printing", 7400, -12, true, "Admin"],
    [null, "OFFICE", "Internet & phone bills", 11800, -18, true, "Accounts"], [0, "MATERIAL", "Local purchase – silicone & fasteners", 8900, -3, true, "Site engineer"],
    [1, "LABOUR", "Tempo unloading labour", 1800, -2, true, "Site supervisor"], [0, "VENDOR", "Crane hire – glass lifting", 38000, -1, false, "Pending approval"],
  ];
  for (const [pi, category, description, amount, off, approved, paidBy] of exp) {
    const e = await prisma.expense.create({ data: { companyId, projectId: pi === null ? null : projects[pi].id, category, description, amount, date: day(off), approved, paidBy, createdById: approved ? accounts.id : engineer.id } });
    if (!approved) await prisma.approval.create({ data: { companyId, type: "EXPENSE", entityType: "Expense", entityId: e.id, title: `Expense – ${description}`, amount, requestedById: engineer.id, requiredRole: "MANAGEMENT", steps: { create: { stepNo: 1, role: "MANAGEMENT" } } } });
  }
}
