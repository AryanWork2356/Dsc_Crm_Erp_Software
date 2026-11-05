import "server-only";
import { db } from "./db";
import { TRADES, vendorTrades } from "./trades";
import type { Opt } from "./enums";

/** For each kind of work: only the vendors who do that work (so the dropdown for Electrical offers electricians). Others are added in Procurement → Vendors. */
export async function tradeVendorOptions(companyId: string): Promise<Record<string, Opt[]>> {
  const vendors = await db.vendor.findMany({ where: { companyId, deletedAt: null }, select: { id: true, name: true, trades: true, contactPerson: true }, orderBy: { name: "asc" }, take: 3000 });
  const out: Record<string, Opt[]> = {};
  for (const t of TRADES) out[t.key] = vendors.filter((v) => vendorTrades(v.trades).includes(t.key)).map((v) => ({ value: v.id, label: v.contactPerson ? `${v.name} (${v.contactPerson})` : v.name }));
  return out;
}

/** The kinds of work chosen on a project, with the vendor for each, in the usual order. */
export async function projectTradeVendors(projectId: string) {
  const rows = await db.projectVendor.findMany({ where: { projectId }, include: { vendor: { select: { id: true, name: true, contactPerson: true, phone: true, whatsapp: true } } } });
  return TRADES.filter((t) => rows.some((r) => r.trade === t.key)).map((t) => ({ trade: t.key, label: t.label, vendor: rows.find((r) => r.trade === t.key)?.vendor ?? null }));
}
