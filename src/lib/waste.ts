import "server-only";
import { db } from "./db";
import { num, round2 } from "./utils";

/**
 * Where did the material go? For one project and each material:
 *
 *   issued to the project   – everything sent from a warehouse to the site (issues)
 *   returned                – sent back to a warehouse
 *   waste / damaged         – recorded as waste, damaged, supplier damage or rework (these also left the site stock)
 *   reusable offcuts        – set aside to use again (stay in stock; recorded so they are not called waste)
 *   still at site           – what the stock records say is there now
 *   used (worked out)       = issued − returned − waste − still at site
 *
 * Nothing here is typed in by hand except the waste records themselves; the rest comes from the stock movements, so the
 * numbers balance by construction and any odd "used" figure (negative, or far above the BOQ quantity) is a count that needs checking.
 */

export type ReconRow = { materialId: string; name: string; unit: string; issued: number; returned: number; waste: number; wasteValue: number; offcuts: number; atSite: number; used: number };

export async function reconcileProject(companyId: string, projectId: string): Promise<ReconRow[]> {
  const [issues, wastes, site] = await Promise.all([
    db.materialIssue.findMany({ where: { companyId, projectId }, select: { purpose: true, items: { select: { materialId: true, quantity: true } } } }),
    db.materialWaste.findMany({ where: { companyId, projectId } }),
    db.warehouse.findFirst({ where: { companyId, projectId, type: "SITE" }, select: { id: true } }),
  ]);
  const balances = site ? await db.stockBalance.findMany({ where: { locationId: site.id } }) : [];
  const ids = new Set<string>();
  const issued = new Map<string, number>();
  const returned = new Map<string, number>();
  for (const i of issues) {
    const isReturn = (i.purpose ?? "").startsWith("RETURN");
    for (const it of i.items) {
      ids.add(it.materialId);
      const m = isReturn ? returned : issued;
      m.set(it.materialId, (m.get(it.materialId) ?? 0) + num(it.quantity));
    }
  }
  const waste = new Map<string, number>();
  const wasteValue = new Map<string, number>();
  const offcuts = new Map<string, number>();
  for (const w of wastes) {
    ids.add(w.materialId);
    if (w.kind === "OFFCUT_REUSABLE") offcuts.set(w.materialId, (offcuts.get(w.materialId) ?? 0) + num(w.quantity));
    else { waste.set(w.materialId, (waste.get(w.materialId) ?? 0) + num(w.quantity)); wasteValue.set(w.materialId, (wasteValue.get(w.materialId) ?? 0) + num(w.costValue)); }
  }
  const atSite = new Map(balances.map((b) => [b.materialId, num(b.quantity)]));
  for (const b of balances) ids.add(b.materialId);
  const mats = ids.size ? await db.material.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, unit: true } }) : [];
  return mats
    .map((m) => {
      const i = issued.get(m.id) ?? 0, r = returned.get(m.id) ?? 0, w = waste.get(m.id) ?? 0, a = atSite.get(m.id) ?? 0;
      return { materialId: m.id, name: m.name, unit: m.unit, issued: i, returned: r, waste: w, wasteValue: round2(wasteValue.get(m.id) ?? 0), offcuts: offcuts.get(m.id) ?? 0, atSite: a, used: round2(i - r - w - a) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
