import "server-only";
import { db } from "./db";
import { TRADES, vendorTrades } from "./trades";
import type { Opt } from "./enums";

/** For each trade: the vendors who do that trade first, then every other vendor (marked), so a director can always pick. */
export async function tradeVendorOptions(companyId: string): Promise<Record<string, Opt[]>> {
  const vendors = await db.vendor.findMany({ where: { companyId, deletedAt: null }, select: { id: true, name: true, trades: true, phone: true }, orderBy: { name: "asc" }, take: 2000 });
  const out: Record<string, Opt[]> = {};
  for (const t of TRADES) {
    const does = vendors.filter((v) => vendorTrades(v.trades).includes(t.key));
    const rest = vendors.filter((v) => !does.includes(v));
    out[t.key] = [...does.map((v) => ({ value: v.id, label: v.name })), ...rest.map((v) => ({ value: v.id, label: `${v.name} (not marked for ${t.label})` }))];
  }
  return out;
}

/** The vendors chosen on a project, in the trade order. */
export async function projectTradeVendors(projectId: string) {
  const rows = await db.projectVendor.findMany({ where: { projectId }, include: { vendor: { select: { id: true, name: true, contactPerson: true, phone: true, whatsapp: true } } } });
  return TRADES.map((t) => ({ trade: t.key, label: t.label, vendor: rows.find((r) => r.trade === t.key)?.vendor ?? null }));
}
