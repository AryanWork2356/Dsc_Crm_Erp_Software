/**
 * DSC's work trades. Each project gets one vendor per trade (chosen by a director when the project is added),
 * and the vendor list can be grouped by them.
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
] as const;
export type TradeKey = (typeof TRADES)[number]["key"];
export const tradeLabel = (k: string) => TRADES.find((t) => t.key === k)?.label ?? k;

/** Words people already wrote in a vendor's "trades" (e.g. "Carpenter, Electrician") → the trade keys. */
const WORDS: Record<TradeKey, RegExp> = {
  ELECTRICAL: /electric/i, GYPSUM: /gyps|false\s*ceil|pop/i, PAINTING: /paint|polish/i, CARPENTRY: /carpent|wood|furniture/i,
  SPRINKLER: /sprinkl/i, FIRE_ALARM: /fire/i, CCTV: /cctv|camera|security/i, CIVIL: /civil|mason|tile|plaster/i, FACADE: /facade|fasad|façade|glaz|acp|aluminium/i,
};
/** The word to look for in a vendor's trades when filtering the list by a trade. */
export const TRADE_WORD: Record<TradeKey, string> = { ELECTRICAL: "electric", GYPSUM: "gypsum", PAINTING: "paint", CARPENTRY: "carpent", SPRINKLER: "sprinkl", FIRE_ALARM: "fire", CCTV: "cctv", CIVIL: "civil", FACADE: "facade" };

export function vendorTrades(text: string | null | undefined): TradeKey[] {
  const t = text ?? "";
  return TRADES.filter((x) => x.key === t.trim() || t.split(/[,;/]/).some((p) => p.trim().toUpperCase() === x.key) || WORDS[x.key].test(t)).map((x) => x.key);
}
