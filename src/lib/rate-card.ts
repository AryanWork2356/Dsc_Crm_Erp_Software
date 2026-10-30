/**
 * A client's rate card = DSC's cost per unit (per sq ft, per rft, per nos …) for the things DSC usually quotes,
 * plus the profit % DSC adds on top for that client. Pure helpers, used by the BOQ screen and the server actions.
 */

/** "Vitrified Tile 600x600" and "vitrified tile 600X600 " are the same row. */
export const rateKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Selling rate = cost + profit % on cost, to the paisa. */
export const sellFromCost = (cost: number, profitPct: number) => Math.round(cost * (1 + profitPct / 100) * 100) / 100;

export type RateRow = { nameKey: string; unit: string; materialRate: number; labourRate: number; otherRate: number };

/** Same name and unit wins; the same name in another unit is used only when it is the only one. */
export function findRate<T extends { nameKey: string; unit: string }>(rates: T[], name: string, unit: string): T | undefined {
  const k = rateKey(name);
  if (!k) return undefined;
  const same = rates.filter((r) => r.nameKey === k);
  return same.find((r) => r.unit === unit) ?? (same.length === 1 ? same[0] : undefined);
}

export const costOf = (r: { materialRate: number; labourRate: number; otherRate: number }) => r.materialRate + r.labourRate + r.otherRate;

// ───────── the same item, worded differently ─────────
// Clients describe the same work in their own words: "Providing and fixing 18 mm BWP ply" / "Supply & installation of 18mm BWP plywood".
// Take away the words that only say HOW it is done, keep the words that say WHAT it is, and compare those.
const FILLER = new Set([
  "providing", "provide", "provided", "supplying", "supply", "supplied", "fixing", "fix", "fixed", "fixation", "laying", "lay", "laid",
  "installing", "install", "installed", "installation", "erecting", "erection", "applying", "apply", "application", "making", "make",
  "testing", "test", "commissioning", "including", "incl", "inclusive", "complete", "completed", "all", "etc", "work", "works", "job",
  "and", "of", "the", "a", "an", "with", "for", "to", "in", "on", "at", "by", "as", "per", "approved", "required", "necessary", "same",
  "pf", "sf", "pnf", "snf", "s", "p", "f", "sitc", "itc", "wherever", "where", "specified", "drawing", "drawings", "design", "instruction", "instructions",
]);
const SAME_WORD: Record<string, string> = { plywood: "ply", ply: "ply", sqft: "sqft", sft: "sqft", nos: "nos", no: "nos", mtr: "m", meter: "m", metre: "m", mm: "mm", thk: "thick", thickness: "thick", colour: "color" };

const NUMBER_WORD: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", single: "1", double: "2" };
/** tiles → tile, painting → paint, flooring → floor (only plain words; sizes like 600x600 stay as they are) */
const stem = (w: string) => (/\d/.test(w) || w.length <= 4 ? w : w.endsWith("ings") ? w.slice(0, -4) : w.endsWith("ing") ? w.slice(0, -3) : w.endsWith("es") && /(ch|sh|x)es$/.test(w) ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** The words that say WHAT the item is ("18mm" stays one word, "18 mm" becomes "18mm"). */
export function wordKey(name: string): string[] {
  const t = name.toLowerCase().replace(/&/g, " and ").replace(/(\d)\s+(mm|cm|m|ft|inch|in|sqft|sft|kg|ltr|w|kw|a)\b/g, "$1$2").replace(/[^a-z0-9]+/g, " ").trim();
  const words = t.split(" ").filter(Boolean).filter((w) => !FILLER.has(w)).map((w) => SAME_WORD[w] ?? NUMBER_WORD[w] ?? stem(w));
  return [...new Set(words)];
}

/** How alike two names are, 0 to 1, after the filler words are gone. Numbers (sizes) must agree exactly. */
export function nameScore(a: string, b: string): number {
  const x = wordKey(a), y = wordKey(b);
  if (!x.length || !y.length) return 0;
  const nums = (w: string[]) => w.filter((s) => /\d/.test(s)).sort().join(",");
  if (nums(x) !== nums(y)) return 0; // 18mm and 12mm ply are different items
  const ys = new Set(y);
  const both = x.filter((w) => ys.has(w)).length;
  return both / Math.max(x.length, y.length);
}

export const CLOSE_ENOUGH = 0.75;

/** The best close match among saved rates (same unit, or the only one with that name), or nothing. */
export function closeRate<T extends { name: string; unit: string }>(rates: T[], name: string, unit: string): { rate: T; score: number } | undefined {
  let best: { rate: T; score: number } | undefined;
  for (const r of rates) {
    if (r.unit !== unit) continue;
    const s = nameScore(name, r.name);
    if (s >= CLOSE_ENOUGH && (!best || s > best.score)) best = { rate: r, score: s };
  }
  return best;
}
