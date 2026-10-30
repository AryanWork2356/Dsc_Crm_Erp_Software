import { CATEGORIES, type RawBill } from "./bill-reader-shared";

/**
 * Turns the plain text a reader found on a bill (printed or handwritten) into the boxes of the form, with simple, careful rules.
 * It never guesses: a value with weak evidence, or none, is left empty or listed in `unsure`, and a person checks every box anyway.
 * Pure text in, plain values out: no network, so it can be tested with the text of real bills.
 */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const year = (y: number) => (y < 100 ? 2000 + y : y);

type Found<T> = { value: T; line: number; strong: boolean };

/** Every date on the page, day-month-year as written in India. */
function dates(lines: string[]): Found<string>[] {
  const out: Found<string>[] = [];
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\b(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2}|\d{4})\b/g)) out.push({ value: iso(year(+m[3]), +m[2], +m[1]), line: i, strong: true });
    for (const m of l.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-.,]*([A-Za-z]{3})[a-z]*[\s\-.,]*(\d{2}|\d{4})\b/g)) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo) out.push({ value: iso(year(+m[3]), mo, +m[1]), line: i, strong: true });
    }
  });
  return out;
}

const NUM = /(?<![\w/.-])(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?(?![\w/-])/g;
const numbersOn = (l: string) => [...l.matchAll(NUM)].map((m) => Number(m[0].replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 0);

const NOT_TOTAL = /sub\s*-?\s*total|taxable|total\s*(?:qty|quantity|items?|tax|gst|discount|saving|weight)|\bin\s+words\b|round\s*off/i;
const TIERS: RegExp[] = [/grand\s*total/i, /(?:total\s*amount|amount\s*payable|net\s*(?:payable|amount)|bill\s*amount|amount\s*due|balance\s*due|invoice\s*(?:total|amount)|total\s*payable|total\s*(?:rs|inr)|payable)/i, /\btotal\b/i, /\bamount\b/i];

function total(lines: string[]): { value: number | null; strong: boolean } {
  for (let t = 0; t < TIERS.length; t++) {
    const cands: number[] = [];
    lines.forEach((l, i) => {
      if (!TIERS[t].test(l) || NOT_TOTAL.test(l)) return;
      let n = numbersOn(l);
      // the figure is often on the next line, under the words
      if (!n.length) for (const j of [i + 1, i + 2]) { if (lines[j] && !/[A-Za-z]{4,}/.test(lines[j])) { n = numbersOn(lines[j]); if (n.length) break; } }
      if (n.length) cands.push(n[n.length - 1]);
    });
    if (cands.length) return { value: Math.max(...cands), strong: t <= 2 };
  }
  return { value: null, strong: false };
}

function billNumber(lines: string[]): { value: string | null; strong: boolean } {
  const keyed = /(?:invoice|inv|bill|receipt|challan|cash\s*memo|voucher|memo)\s*(?:no|number|#)?\s*\.?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9/\-._]{1,24})/i;
  const bare = /\b(?:no|number)\s*\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9/\-._]{2,24})/i;
  const ok = (s: string) => /\d/.test(s) && !/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(s) && !/^(?:dated?|date)$/i.test(s);
  for (const l of lines) { const m = keyed.exec(l); if (m && ok(m[1])) return { value: m[1].replace(/[.,]$/, ""), strong: true }; }
  for (const l of lines) { const m = bare.exec(l); if (m && ok(m[1])) return { value: m[1].replace(/[.,]$/, ""), strong: false }; }
  return { value: null, strong: false };
}

const DOC_WORDS = /^(?:tax\s*invoice|invoice|cash\s*memo|cash\s*bill|bill|receipt|delivery\s*challan|challan|original|duplicate|estimate|quotation|credit\s*memo|gst\s*invoice|retail\s*invoice|bill\s*of\s*supply|customer\s*copy)$/i;

function vendor(lines: string[]): string | null {
  for (const l of lines.slice(0, 8)) {
    const t = l.replace(/[|_*~]+/g, " ").replace(/\s+/g, " ").trim();
    const letters = (t.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 4 || DOC_WORDS.test(t) || /^(?:gstin|gst|pan|ph|phone|mob|tel|date|no|bill|invoice)\b/i.test(t) || /^\d/.test(t) || letters / t.length < 0.55) continue;
    return t.slice(0, 120);
  }
  return null;
}

const CATEGORY: [RegExp, (typeof CATEGORIES)[number]][] = [
  [/tempo|transport|fuel|petrol|diesel|taxi|\bauto\b|\bcab\b|toll|freight|lorry|truck|parking|ola|uber/i, "TRAVEL"],
  [/labou?r|wages|mazdoor|salary/i, "LABOUR"],
  [/stationery|printing|xerox|photocopy|rent|internet|courier/i, "OFFICE"],
  [/ply|laminate|hardware|screw|fevicol|adhesive|paint|putty|primer|tile|cement|wire|switch|sanitary|glass|hinge|channel|electrical|light|lamp|plumb|pipe|fitting|sand|brick|steel|bolt|nail|drill|gypsum|board|handle|lock/i, "MATERIAL"],
  [/installation|service|sub-?contract|work done|job work|fabrication/i, "VENDOR"],
];

const ITEM = /^[A-Za-z][A-Za-z0-9 .,'"()\-/&x@%]{3,60}?\s+(?:rs\.?\s*)?\d[\d,]*(?:\.\d{1,2})?$/;
const ITEM_STOP = /total|gst|cgst|sgst|igst|tax|amount|bill|invoice|date|phone|ph\b|thank|visit|mob|gstin|pan\b|round|discount|balance|cash|paid|change|vat/i;

export function parseBillText(text: string, avgConfidence = 1): RawBill {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[\t ]+/g, " ").trim()).filter(Boolean);
  const upper = text.toUpperCase();
  const gstin = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/.exec(upper)?.[0] ?? null;
  const ds = dates(lines);
  const dueLine = (l: number) => /due|payable\s*(?:by|on)|pay\s*by/i.test(lines[l] ?? "");
  const dateLine = (l: number) => /date|dated|\bdt\b/i.test(lines[l] ?? "") && !dueLine(l);
  const due = ds.find((d) => dueLine(d.line)) ?? null;
  const rest = ds.filter((d) => d !== due);
  const keyed = rest.find((d) => dateLine(d.line));
  const billDate = keyed ?? rest[0] ?? null;
  const tot = total(lines);
  const no = billNumber(lines);
  const ven = vendor(lines);
  const items = lines.filter((l) => ITEM.test(l) && !ITEM_STOP.test(l)).map((l) => l.replace(/\s+(?:rs\.?\s*)?\d[\d,]*(?:\.\d{1,2})?$/i, "").trim()).slice(0, 3);
  const description = ven ? (items.length ? `${ven}: ${items.join(", ")}` : ven) : items.join(", ") || null;
  const category = CATEGORY.find(([re]) => re.test(text))?.[1] ?? "MISC";

  const letters = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  const readable = letters >= 20 && avgConfidence >= 0.45;
  const looksLikeBill = /invoice|bill|receipt|challan|memo|total|amount|gst|cash|qty|rate|rs\b|₹/i.test(text) && /\d/.test(text);
  const unclear = avgConfidence < 0.8; // handwriting and poor photos read with lower confidence
  const unsure: string[] = [];
  if (tot.value != null && (!tot.strong || unclear)) unsure.push("totalAmount");
  if (billDate && (!billDate.strong || unclear)) unsure.push("billDate");
  if (no.value && (!no.strong || unclear)) unsure.push("billNumber");
  if (!items.length) unsure.push("description");
  if (!ven || unclear) unsure.push("vendorName");

  return {
    isBill: looksLikeBill, readable, handwritten: unclear,
    vendorName: ven, vendorGstin: gstin, billNumber: no.value,
    billDate: billDate?.value ?? null, dueDate: due?.value ?? null,
    totalAmount: tot.value, taxAmount: null, description, category, unsure,
    note: unclear ? "The text was read with low confidence (handwriting or a poor photo). Please check every box." : tot.value == null && looksLikeBill ? "No total was found on this bill (it may be a delivery note). Please type the amount." : null,
  };
}
