import { round2 } from "./utils";

/**
 * GST split. Supplier and place of supply in the same state → CGST + SGST (half each); different states → IGST.
 * Place of supply = what the user chose on the document, else the state in the client's GSTIN, else the company's own state.
 * Tax is split per rate from the lines (discount applied proportionally, like the totals), then scaled to match the
 * stored tax amount to the paisa so the printed split always adds up.
 */

export const STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
export const STATE_OPTIONS = Object.entries(STATES).map(([code, name]) => ({ value: code, label: `${name} (${code})` }));

export function stateFromGstin(gstin: string | null | undefined): string | null {
  const m = /^(\d{2})[A-Z0-9]{13}$/i.exec((gstin ?? "").trim());
  return m && STATES[m[1]] ? m[1] : null;
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** True when the 15th character is the right check character for the first 14 (a typing slip almost always breaks this). */
export function gstinChecksumOk(gstin: string): boolean {
  const g = gstin.trim().toUpperCase();
  if (!GSTIN_SHAPE.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
}

/** Characters 3 to 12 of a GSTIN are the company's PAN. */
export function panFromGstin(gstin: string | null | undefined): string | null {
  const g = (gstin ?? "").trim().toUpperCase();
  return GSTIN_SHAPE.test(g) ? g.slice(2, 12) : null;
}

/** What the GSTIN itself tells us, without asking anyone: state, PAN and whether it was typed correctly. */
export function readGstin(gstin: string): { state: string | null; pan: string | null; checksumOk: boolean } {
  return { state: STATES[gstin.trim().slice(0, 2)] ?? null, pan: panFromGstin(gstin), checksumOk: gstinChecksumOk(gstin) };
}

export type TaxRateRow = { rate: number; taxable: number; cgst: number; sgst: number; igst: number };
export type TaxSplit = { type: "INTRA" | "INTER"; companyState: string | null; supplyState: string | null; rates: TaxRateRow[]; cgst: number; sgst: number; igst: number; tax: number; taxable: number };

export function splitTax(
  lines: { amount: number; taxPercent: number }[],
  o: { companyGstin?: string | null; partyGstin?: string | null; placeOfSupply?: string | null; discount?: number; storedTax?: number },
): TaxSplit {
  const companyState = stateFromGstin(o.companyGstin);
  const supplyState = (o.placeOfSupply && STATES[o.placeOfSupply] ? o.placeOfSupply : null) ?? stateFromGstin(o.partyGstin) ?? companyState;
  const inter = !!companyState && !!supplyState && companyState !== supplyState;

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const ratio = subtotal > 0 ? Math.min(Math.max(o.discount ?? 0, 0), subtotal) / subtotal : 0;
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.taxPercent, (byRate.get(l.taxPercent) ?? 0) + l.amount * (1 - ratio));

  const rows = [...byRate.entries()].filter(([rate]) => rate > 0).sort((a, b) => a[0] - b[0]).map(([rate, taxable]) => ({ rate, taxable: round2(taxable), tax: round2((taxable * rate) / 100) }));
  // make the split add up to the stored tax amount (rounding), by adjusting the largest row
  if (o.storedTax !== undefined && rows.length) {
    const diff = round2(o.storedTax - rows.reduce((s, r) => s + r.tax, 0));
    if (diff !== 0) { const big = rows.reduce((a, b) => (b.tax > a.tax ? b : a)); big.tax = round2(big.tax + diff); }
  }
  const out: TaxRateRow[] = rows.map((r) => {
    if (inter) return { rate: r.rate, taxable: r.taxable, cgst: 0, sgst: 0, igst: r.tax };
    const half = round2(r.tax / 2);
    return { rate: r.rate, taxable: r.taxable, cgst: half, sgst: round2(r.tax - half), igst: 0 };
  });
  const sum = (k: "cgst" | "sgst" | "igst" | "taxable") => round2(out.reduce((s, r) => s + r[k], 0));
  return { type: inter ? "INTER" : "INTRA", companyState, supplyState, rates: out, cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), tax: round2(sum("cgst") + sum("sgst") + sum("igst")), taxable: sum("taxable") };
}

/** Lines for the totals box of a PDF: "CGST @ 9%", "SGST @ 9%" … or "IGST @ 18%". */
export function taxTotalRows(s: TaxSplit, fmt: (n: number) => string): [string, string][] {
  const rows: [string, string][] = [];
  for (const r of s.rates) {
    if (s.type === "INTER") rows.push([`IGST @ ${r.rate}%`, fmt(r.igst)]);
    else { rows.push([`CGST @ ${r.rate / 2}%`, fmt(r.cgst)]); rows.push([`SGST @ ${r.rate / 2}%`, fmt(r.sgst)]); }
  }
  return rows;
}

export const placeLabel = (code: string | null) => (code && STATES[code] ? `${STATES[code]} (${code})` : "—");
