/**
 * Site measurement sheet maths (feet + inches), as on DSC's M-Sheet:
 *   Description | Ft In (length) | Ft In (width) | Sq ft | Qty | Final qty
 * "Less" rows (openings, staircase, areas done in another material) are deducted.
 * Pure functions – used by the BOQ editor (live) and the server (the server always recomputes).
 */

export type MeasureLine = { desc?: string; lenFt: number; lenIn: number; widFt: number; widIn: number; qty: number; less: boolean };
export type Basis = "AREA" | "LENGTH" | "COUNT";

const SQFT_TO_SQM = 0.09290304;
const FT_TO_M = 0.3048;

/** What the item's unit measures: area (sqft, sqm), running length (rft, rmt) or a plain count. */
export function basisFor(unit: string): Basis {
  const u = unit.trim().toLowerCase().replace(/\s+/g, "");
  if (u === "sqft" || u === "sqm" || u === "sft") return "AREA";
  if (u === "rft" || u === "rmt") return "LENGTH";
  return "COUNT";
}

export const feet = (ft: number, inch: number) => (Number(ft) || 0) + (Number(inch) || 0) / 12;

/** Value of one line in the item's own unit (negative for "less" rows). */
export function lineValue(l: MeasureLine, unit: string): number {
  const basis = basisFor(unit);
  const length = feet(l.lenFt, l.lenIn);
  const width = feet(l.widFt, l.widIn);
  let base = basis === "AREA" ? length * width : basis === "LENGTH" ? length : 1;
  const u = unit.trim().toLowerCase();
  if (u === "sqm") base *= SQFT_TO_SQM;
  if (u === "rmt") base *= FT_TO_M;
  const v = base * (Number(l.qty) || 0);
  return l.less ? -v : v;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The BOQ quantity: sum of all lines, never below zero. */
export function finalQty(lines: MeasureLine[], unit: string): number {
  return Math.max(0, round3(lines.reduce((s, l) => s + lineValue(l, unit), 0)));
}

/** Plain-language problems with a line (empty = fine). */
export function lineProblem(l: MeasureLine, unit: string): string | null {
  const basis = basisFor(unit);
  if ([l.lenFt, l.lenIn, l.widFt, l.widIn, l.qty].some((x) => !Number.isFinite(Number(x)) || Number(x) < 0)) return "Measurements can't be negative.";
  if (l.lenIn >= 12 || l.widIn >= 12) return "Inches must be less than 12 – add the extra to feet.";
  if (basis !== "COUNT" && feet(l.lenFt, l.lenIn) === 0) return "Enter the length.";
  if (basis === "AREA" && feet(l.widFt, l.widIn) === 0) return "Enter the width.";
  if (!(Number(l.qty) > 0)) return "Qty must be at least 1.";
  return null;
}

export function cleanLine(l: Partial<MeasureLine>): MeasureLine {
  const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  return { desc: l.desc?.toString().slice(0, 120) || undefined, lenFt: n(l.lenFt), lenIn: n(l.lenIn), widFt: n(l.widFt), widIn: n(l.widIn), qty: n(l.qty) || 0, less: !!l.less };
}

export const blankLine = (): MeasureLine => ({ desc: "", lenFt: 0, lenIn: 0, widFt: 0, widIn: 0, qty: 1, less: false });

/** Reads the JSON column safely. */
export function parseMeasurements(json: unknown): MeasureLine[] {
  const lines = json && typeof json === "object" && "lines" in json ? (json as { lines: unknown }).lines : null;
  return Array.isArray(lines) ? lines.map((l) => cleanLine(l as Partial<MeasureLine>)) : [];
}
