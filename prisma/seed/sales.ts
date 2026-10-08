import type { BoqCategory, PrismaClient, QuotationStatus } from "@prisma/client";
import type { CoreSeed } from "./core";
import type { CrmSeed } from "./crm";
import { computeTotals } from "../../src/lib/money";

const day = (offset: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

type L = [BoqCategory, string, string, number, number];

const QUOTES: { client: number; lead?: number; title: string; status: QuotationStatus; disc: number; ago: number; lines: L[] }[] = [
  {
    client: 0, lead: 9, title: "3BHK full interior – Lodha Splendora", status: "ACCEPTED", disc: 5, ago: 40,
    lines: [
      ["CIVIL", "Demolition & masonry modifications", "lumpsum", 1, 185000], ["CARPENTRY", "Modular kitchen with hardware", "rft", 14, 7800],
      ["CARPENTRY", "Master bedroom wardrobe (sliding)", "sqft", 78, 1750], ["CARPENTRY", "TV unit with back panel", "nos", 1, 62000],
      ["FALSE_CEILING", "Gypsum false ceiling with cove", "sqft", 920, 135], ["ELECTRICAL", "Electrical points & wiring", "nos", 64, 950],
      ["PAINTING", "Premium emulsion, 2 coats", "sqft", 4200, 34], ["FLOORING", "Vitrified tile flooring", "sqft", 1450, 118],
    ],
  },
  {
    client: 2, title: "Retail store – Viviana Mall", status: "SENT", disc: 0, ago: 6,
    lines: [
      ["FIXTURES", "Display wall units", "rft", 60, 9500], ["CARPENTRY", "Billing counter", "nos", 1, 145000], ["LIGHTING", "Track lights & spots", "nos", 48, 3200],
      ["FLOORING", "Epoxy flooring", "sqft", 1800, 95], ["FALSE_CEILING", "Grid ceiling", "sqft", 1800, 78],
    ],
  },
  {
    client: 1, title: "Boutique café – Hiranandani", status: "PENDING_APPROVAL", disc: 3, ago: 2,
    lines: [
      ["FURNITURE", "Café seating (custom)", "nos", 32, 6800], ["CARPENTRY", "Service counter", "nos", 1, 210000], ["HVAC", "Ductable AC points", "nos", 3, 85000],
      ["DECOR", "Wall graphics & signage", "lumpsum", 1, 120000], ["PLUMBING", "Pantry plumbing", "lumpsum", 1, 68000],
    ],
  },
  {
    client: 3, title: "Dental clinic – Naupada", status: "DRAFT", disc: 0, ago: 1,
    lines: [
      ["CIVIL", "Partition & civil work", "lumpsum", 1, 140000], ["CARPENTRY", "Reception & storage units", "nos", 1, 175000], ["ELECTRICAL", "Electrical with dental-chair points", "lumpsum", 1, 96000],
    ],
  },
];

export async function seedSales(prisma: PrismaClient, core: CoreSeed, crm: CrmSeed) {
  const { companyId } = core;
  if ((await prisma.quotation.count({ where: { companyId } })) > 0) return;
  const sales = core.users.filter((u) => u.role === "SALES");
  const terms = await prisma.termsAndConditions.findFirst({ where: { companyId, kind: "QUOTATION", isDefault: true } });

  let n = 0;
  for (const q of QUOTES) {
    n++;
    const t = computeTotals(q.lines.map((l) => ({ quantity: l[3], rate: l[4], taxPercent: 18 })), { pct: q.disc });
    await prisma.quotation.create({
      data: {
        companyId, number: `QT-${String(n).padStart(5, "0")}`, clientId: crm.clientIds[q.client], leadId: q.lead !== undefined ? crm.leadIds[q.lead] : null,
        title: q.title, status: q.status, date: day(-q.ago), validUntil: day(30 - q.ago), preparedById: sales[n % sales.length].id,
        discountPct: q.disc, subtotal: t.subtotal, discountAmount: t.discount, taxAmount: t.tax, total: t.total,
        terms: terms?.body, paymentTerms: "40% advance, 30% on carcass completion, 20% on finishing, 10% on handover.",
        items: { create: q.lines.map((l, i) => ({ sortOrder: i, category: l[0], description: l[1], unit: l[2], quantity: l[3], rate: l[4], taxPercent: 18, amount: t.lines[i].amount })) },
      },
    });
  }
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "QT" } }, update: { value: n }, create: { companyId, key: "QT", value: n } });

  // the pending quotation needs a real approval request so the approver sees it
  const pending = await prisma.quotation.findFirst({ where: { companyId, status: "PENDING_APPROVAL" } });
  if (pending) {
    await prisma.approval.create({
      data: {
        companyId, type: "QUOTATION", entityType: "Quotation", entityId: pending.id, title: `Quotation ${pending.number}`, amount: pending.total,
        requestedById: sales[0].id, requiredRole: "MANAGEMENT", steps: { create: { stepNo: 1, role: "MANAGEMENT" } },
      },
    });
  }
}
