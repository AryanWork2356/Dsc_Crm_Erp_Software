import { round2 } from "./utils";

export type LineInput = { quantity: number; rate: number; taxPercent: number };

export type Totals = {
  subtotal: number; // sum of qty*rate before discount and tax
  discount: number;
  taxable: number; // subtotal - discount
  tax: number;
  total: number;
  lines: { amount: number; tax: number }[]; // amount = qty*rate (pre-tax, pre-discount)
};

/**
 * The single source of truth for document totals (quotation, PO, invoice).
 * The server ALWAYS recomputes with this – client-side numbers are display-only.
 *
 * Discount is applied proportionally across lines, and tax is computed per line on the discounted amount
 * (so mixed tax rates stay correct, as GST requires).
 */
export function computeTotals(items: LineInput[], discount: { pct?: number; amount?: number } = {}): Totals {
  const lines = items.map((i) => ({ amount: round2(i.quantity * i.rate) }));
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  let disc = discount.pct && discount.pct > 0 ? round2((subtotal * discount.pct) / 100) : round2(discount.amount ?? 0);
  disc = Math.min(Math.max(disc, 0), subtotal);
  const ratio = subtotal > 0 ? disc / subtotal : 0;

  let tax = 0;
  const out = items.map((i, idx) => {
    const afterDiscount = lines[idx].amount * (1 - ratio);
    const t = round2((afterDiscount * i.taxPercent) / 100);
    tax += t;
    return { amount: lines[idx].amount, tax: t };
  });
  tax = round2(tax);
  const taxable = round2(subtotal - disc);
  return { subtotal, discount: disc, taxable, tax, total: round2(taxable + tax), lines: out };
}

export type BoqLine = {
  quantity: number;
  materialCost: number;
  labourCost: number;
  otherCost: number;
  sellingRate: number;
};

/** BOQ item: unit costs are per unit; returns stored estimated cost + selling total. */
export function boqItemTotals(i: BoqLine) {
  const unitCost = i.materialCost + i.labourCost + i.otherCost;
  return {
    estimatedCost: round2(unitCost * i.quantity),
    total: round2(i.sellingRate * i.quantity),
  };
}

export function boqSummary(items: { estimatedCost: number; total: number }[]) {
  const cost = round2(items.reduce((s, i) => s + i.estimatedCost, 0));
  const revenue = round2(items.reduce((s, i) => s + i.total, 0));
  const margin = round2(revenue - cost);
  return { cost, revenue, margin, marginPct: revenue > 0 ? round2((margin / revenue) * 100) : 0 };
}

/** Number to Indian-English words for invoice/PO totals, e.g. "Rupees One Lakh Twenty Thousand Only". */
export function amountInWords(n: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : ""));
  const three = (x: number) => (x >= 100 ? ones[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x));
  const rupees = Math.floor(Math.abs(n));
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 1e7);
  const lakh = Math.floor((rupees % 1e7) / 1e5);
  const thou = Math.floor((rupees % 1e5) / 1e3);
  const rest = rupees % 1e3;
  if (crore) parts.push(three(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thou) parts.push(two(thou) + " Thousand");
  if (rest) parts.push(three(rest));
  let s = "Rupees " + parts.join(" ");
  if (paise) s += " and " + two(paise) + " Paise";
  return s + " Only";
}
