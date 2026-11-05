/**
 * DSC's kinds of work and supply ("trades"). A project is given the kinds of work it needs, and for each one a vendor
 * (chosen by a director). The vendor list is grouped by the same kinds, so the dropdown for "Electrical" only offers electricians.
 * New vendors are added in Procurement → Vendors, where the kinds they do are ticked.
 *
 * The first nine are the site trades; the rest come from the company's own supplier list.
 */
export const TRADES = [
  { key: "ELECTRICAL", label: "Electrical" },
  { key: "GYPSUM", label: "Gypsum" },
  { key: "PAINTING", label: "Painting" },
  { key: "CARPENTRY", label: "Carpentry" },
  { key: "SPRINKLER", label: "Sprinkler" },
  { key: "FIRE_ALARM", label: "Fire alarm" },
  { key: "CCTV", label: "CCTV" },
  { key: "CIVIL", label: "Civil" },
  { key: "FACADE", label: "Facade" },
  { key: "HARDWARE", label: "Hardware" },
  { key: "PLYWOOD", label: "Plywood" },
  { key: "LAMINATE", label: "Laminate" },
  { key: "MDF", label: "MDF" },
  { key: "TILES", label: "Tiles" },
  { key: "GLASS", label: "Glass" },
  { key: "ALUMINIUM", label: "Aluminium" },
  { key: "STEEL", label: "Steel" },
  { key: "RACKS", label: "Racks" },
  { key: "INVERTER", label: "Inverter" },
  { key: "COREAN", label: "Corean" },
  { key: "EDGE_BAND", label: "Edge band" },
  { key: "MATTRESS", label: "Mattress" },
  { key: "FURNITURE_FINISH", label: "Furniture finishing" },
  { key: "DECOR", label: "Decor" },
  { key: "TOOLS", label: "Tools & equipment" },
] as const;
export type TradeKey = (typeof TRADES)[number]["key"];
export const tradeLabel = (k: string) => TRADES.find((t) => t.key === k)?.label ?? k;

/** Words people already wrote in a vendor's "trades" (e.g. "Carpenter, Electrician") → the trade keys. */
const WORDS: Record<TradeKey, RegExp> = {
  ELECTRICAL: /electric/i, GYPSUM: /gyps|false\s*ceil|\bpop\b/i, PAINTING: /paint|polish/i, CARPENTRY: /carpent|(?<!ply)wood\s*work/i,
  SPRINKLER: /sprinkl/i, FIRE_ALARM: /fire/i, CCTV: /cctv|camera|security/i, CIVIL: /civil|mason|plaster/i, FACADE: /facade|fasad|façade|glaz|\bacp\b/i,
  HARDWARE: /hardware/i, PLYWOOD: /\bply\b|plywood|\bply\s*&/i, LAMINATE: /lamin/i, MDF: /\bmdf\b/i, TILES: /\btiles?\b/i, GLASS: /\bglass\b/i,
  ALUMINIUM: /alumin/i, STEEL: /\bsteel\b/i, RACKS: /\brack/i, INVERTER: /inverter/i, COREAN: /corean|corian/i, EDGE_BAND: /edge\s*band|edge\s*bind/i,
  MATTRESS: /ma[t]{1,2}ress/i, FURNITURE_FINISH: /furniture|finishing/i, DECOR: /d[eé]cor|d.cor|decor/i, TOOLS: /tool|equipment/i,
};
/** The word to look for in a vendor's trades when filtering the list by a trade. */
export const TRADE_WORD: Record<TradeKey, string> = {
  ELECTRICAL: "electric", GYPSUM: "gypsum", PAINTING: "paint", CARPENTRY: "carpent", SPRINKLER: "sprinkl", FIRE_ALARM: "fire", CCTV: "cctv", CIVIL: "civil", FACADE: "facade",
  HARDWARE: "hardware", PLYWOOD: "plywood", LAMINATE: "lamin", MDF: "mdf", TILES: "tile", GLASS: "glass", ALUMINIUM: "alumin", STEEL: "steel", RACKS: "rack", INVERTER: "inverter",
  COREAN: "corean", EDGE_BAND: "edge band", MATTRESS: "mattress", FURNITURE_FINISH: "furniture finishing", DECOR: "decor", TOOLS: "tools",
};

export function vendorTrades(text: string | null | undefined): TradeKey[] {
  const t = text ?? "";
  return TRADES.filter((x) => x.key === t.trim() || t.split(/[,;/]/).some((p) => p.trim().toUpperCase() === x.key) || WORDS[x.key].test(t)).map((x) => x.key);
}
