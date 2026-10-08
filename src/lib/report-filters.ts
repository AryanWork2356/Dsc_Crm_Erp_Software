import type { Filters } from "./reports";

const iso = /^\d{4}-\d{2}-\d{2}$/;

/** Reads report filters from query params. `to` is inclusive for users, exclusive internally. Defaults to this month. */
export function parseFilters(sp: Record<string, string | undefined>): Filters & { fromStr: string; toStr: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromStr = iso.test(sp.from ?? "") ? sp.from! : ymd(first);
  const toStr = iso.test(sp.to ?? "") ? sp.to! : ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const from = new Date(fromStr + "T00:00:00");
  let to = new Date(new Date(toStr + "T00:00:00").getTime() + 86400000);
  if (to <= from) to = new Date(from.getTime() + 86400000);
  return { from, to, fromStr, toStr, projectId: sp.project || undefined, clientId: sp.client || undefined, vendorId: sp.vendor || undefined };
}
