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
