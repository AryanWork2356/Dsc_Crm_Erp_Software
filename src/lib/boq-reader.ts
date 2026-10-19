import "server-only";
import ExcelJS from "exceljs";
import type { BoqCategory } from "@prisma/client";

/**
 * Reads a CLIENT's BOQ workbook, whatever its layout, into rows DSC can price.
 * It looks for the header row on every sheet (even a two-row header like "Qty | Rate | Amount" split across rows),
 * works out which column is the description / unit / quantity / rate, follows section headings ("B  Flooring Works")
 * to set categories, and ignores totals, GST lines and blank rows. Nothing is saved here – the caller shows a preview.
 */

export type ReadItem = {
  sheet: string; row: number; sl: string; section: string; category: BoqCategory;
  item: string; specification: string; unit: string; quantity: number; rate: number | null; remarks: string; flags: string[];
};
export type ReadSheet = { name: string; headerRow: number; columns: Record<string, string>; items: ReadItem[]; sections: string[]; skipped: number; warnings: string[] };

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const HEADERS: Record<string, string[]> = {
  sl: ["sl no", "sl", "s no", "sr no", "sr", "item no", "no", "ref", "code", "serial no", "sno"],
  item: ["description", "work title", "item", "item description", "particulars", "work item", "scope of work", "description of work", "name of work", "work description", "item of work", "fixtures", "fixture", "fixture description", "product", "material description", "items"],
  spec: ["detailed specification", "specification", "specifications", "spec", "details", "technical specification", "brand make", "size", "dimensions"],
  unit: ["unit", "uom", "u o m", "units", "unit of measurement"],
  qty: ["qty", "quantity", "qnty", "quantities", "qty nos"],
  rate: ["rate", "unit rate", "rate inr", "rate rs", "price", "unit price", "rate per unit"],
  amount: ["amount", "amt", "total", "total amount", "value", "amount inr", "amount rs", "total price"],
  remarks: ["remark", "remarks", "note", "notes", "comments"],
};
const find = (cell: string): string | null => {
  for (const [key, list] of Object.entries(HEADERS)) if (list.includes(cell)) return key;
  return null;
};

const UNITS: Record<string, string> = {
  "sq ft": "sqft", sqft: "sqft", sft: "sqft", "sq feet": "sqft", "sq.ft": "sqft", "square feet": "sqft", "sq mtr": "sqm", sqm: "sqm", "sq m": "sqm", "sq mt": "sqm",
  rft: "rft", "r ft": "rft", "rft.": "rft", "running feet": "rft", rmt: "rmt", rm: "rmt", mtr: "rmt", mtrs: "rmt", meter: "rmt", metre: "rmt", m: "rmt",
  nos: "nos", no: "nos", number: "nos", numbers: "nos", pcs: "nos", pc: "nos", each: "nos", ea: "nos", unit: "nos", units: "nos",
  set: "set", sets: "set", kg: "kg", kgs: "kg", ltr: "ltr", litre: "ltr", liter: "ltr", ltrs: "ltr", bag: "bag", box: "box", bags: "bag",
  ls: "lumpsum", "l s": "lumpsum", lumpsum: "lumpsum", "lump sum": "lumpsum", job: "lumpsum", day: "day", days: "day", hour: "hour", hr: "hour", hrs: "hour",
};

/** keyword → category, checked against the section heading first, then the sheet name */
const CATEGORY_WORDS: [RegExp, BoqCategory][] = [
  [/fire|alarm|smoke|detector|sprinkler|hooter/i, "ELECTRICAL"],
  [/demolition|dismantl|civil|masonry|plaster|waterproof|screed|pcc/i, "CIVIL"],
  [/floor|tile|granite|marble|epoxy|vinyl|carpet|skirting/i, "FLOORING"],
  [/false ceiling|ceiling|gypsum|grid/i, "FALSE_CEILING"],
  [/paint|polish|putty|texture|wall finish|wallpaper|wall & ceiling|wall and ceiling/i, "PAINTING"],
  [/electric|wiring|cabling|conduit|switch|socket|db |earthing|cctv|data|speaker|audio|signage wiring/i, "ELECTRICAL"],
  [/light|led|lamp|luminaire/i, "LIGHTING"],
  [/plumb|sanitary|pipe|drain|cpvc|toilet|water supply/i, "PLUMBING"],
  [/hvac|air condition|ac |ducting|ventilation/i, "HVAC"],
  [/glass|glazing|mirror|aluminium window|facade|façade/i, "GLASS"],
  [/fabricat|ms |steel|metal|structure|frame|railing|shutter/i, "FABRICATION"],
  [/furniture|loose|sofa|chair|table|counter|wardrobe|cabinet|shelf|fixture|display|podium/i, "FIXTURES"],
  [/partition|panel|carpentry|ply|laminate|veneer|door|window|cladding|wood/i, "CARPENTRY"],
  [/hardware|handle|hinge|lock|channel/i, "HARDWARE"],
  [/decor|graphics|vinyl print|artwork|plants|accessor/i, "DECOR"],
];
export function categoryFor(...texts: string[]): BoqCategory {
  for (const t of texts) for (const [re, cat] of CATEGORY_WORDS) if (t && re.test(t)) return cat;
  return "OTHER";
}

/** Heading first, else the sheet's name (an "ELECTRICAL" sheet), else the item's own words. A heading we can't classify stays OTHER-then-item. */
function pickCategory(section: string, name: string, sheet: string): BoqCategory {
  if (section) {
    const c = categoryFor(section);
    return c !== "OTHER" ? c : categoryFor(name);
  }
  const c = categoryFor(sheet);
  return c !== "OTHER" ? c : categoryFor(name);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined && v.result !== null) return String(v.result).trim();
    if ("text" in v) return String(v.text).trim();
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    return "";
  }
  return String(v).replace(/\s+/g, " ").trim();
}
function numberOf(t: string): number | null {
  if (!t) return null;
  const x = Number(t.replace(/[,₹\s]|rs\.?/gi, ""));
  return Number.isFinite(x) ? x : null;
}

const TOTAL_LINE = /^(sub\s*-?\s*total\w*|total\w*|grand total|gst|igst|cgst|sgst|tax|summary|amount in words|note|notes|terms|remark|remarks|add|less|round)\b/i;

export async function readClientBoq(buf: Buffer): Promise<ReadSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const out: ReadSheet[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    const sheet = readSheet(ws);
    if (sheet) out.push(sheet);
  }
  return out;
}

function readSheet(ws: ExcelJS.Worksheet): ReadSheet | null {
  const rowCount = Math.min(ws.rowCount, 4000);
  const width = Math.min(ws.columnCount || 1, 40);
  const textAt = (r: number, c: number) => cellText(ws.getRow(r).getCell(c).value);

  // 1. find the header row: needs a description-like AND a quantity-like column (plus unit or rate or amount)
  let headerRow = 0;
  let cols: Record<string, number> = {};
  for (let r = 1; r <= Math.min(60, rowCount) && !headerRow; r++) {
    const found: Record<string, number> = {};
    for (let c = 1; c <= width; c++) {
      const k = find(norm(textAt(r, c)));
      if (k && found[k] === undefined) found[k] = c;
    }
    if (found.item && found.qty && (found.unit || found.rate || found.amount)) { headerRow = r; cols = found; }
  }
  if (!headerRow) return null;
  // two-row headers: "Qty" on one row, "Rate | Amount" on the next
  let first = headerRow + 1;
  const below: Record<string, number> = {};
  for (let c = 1; c <= width; c++) { const k = find(norm(textAt(headerRow + 1, c))); if (k && cols[k] === undefined && below[k] === undefined) below[k] = c; }
  const looksLikeHeaderRow = (below.rate || below.amount || below.unit) && !numberOf(textAt(headerRow + 1, cols.qty));
  if (looksLikeHeaderRow && !(textAt(headerRow + 1, cols.item) && numberOf(textAt(headerRow + 1, cols.qty)) !== null)) {
    for (const [k, c] of Object.entries(below)) if (cols[k] === undefined) cols[k] = c;
    first = headerRow + 2;
  }

  const letters = (c?: number) => (c ? ws.getColumn(c).letter : "—");
  const result: ReadSheet = {
    name: ws.name, headerRow,
    columns: { Description: letters(cols.item), Specification: letters(cols.spec), Unit: letters(cols.unit), Quantity: letters(cols.qty), Rate: letters(cols.rate), "Serial no.": letters(cols.sl) },
    items: [], sections: [], skipped: 0, warnings: [],
  };
  // a sheet whose item column is headed "FIXTURES" is a fixtures list, whatever the words in each row say
  const fixturesSheet = ["fixtures", "fixture", "fixture description"].includes(norm(textAt(headerRow, cols.item)));
  let section = "";
  let blank = 0;
  for (let r = first; r <= rowCount; r++) {
    const sl = cols.sl ? textAt(r, cols.sl) : "";
    const itemText = textAt(r, cols.item);
    const spec = cols.spec ? textAt(r, cols.spec) : "";
    const unitRaw = cols.unit ? textAt(r, cols.unit) : "";
    const qtyRaw = textAt(r, cols.qty);
    const rateRaw = cols.rate ? textAt(r, cols.rate) : "";
    const label = itemText || (sl && !/^\d+(\.\d+)*$/.test(sl) ? sl : "");

    if (!itemText && !qtyRaw && !unitRaw && !rateRaw && !spec) { if (++blank > 25) break; continue; }
    blank = 0;
    if (find(norm(itemText)) === "item" && find(norm(qtyRaw)) === "qty") { result.skipped++; continue; } // repeated header
    const q = numberOf(qtyRaw);
    const rate = numberOf(rateRaw);
    const hasMeasure = q !== null || !!unitRaw || rate !== null || !!qtyRaw;
    if (!hasMeasure) {
      // a heading such as "B  Flooring Works" (or a note); totals and notes are ignored
      if (label && !TOTAL_LINE.test(label)) {
        section = label.replace(/^[A-Za-z]?\s*[\-.)]\s*/, "").trim() || label;
        if (!result.sections.includes(section)) result.sections.push(section);
      } else result.skipped++;
      continue;
    }
    if (!itemText && !spec) { result.skipped++; continue; }
    if (TOTAL_LINE.test(itemText) && !unitRaw) { result.skipped++; continue; }

    const flags: string[] = [];
    let quantity = q ?? 0;
    if (q === null && qtyRaw) flags.push(`Quantity "${qtyRaw}" is not a number – set to 0, check at site`);
    else if (q === null) flags.push("No quantity given");
    if (q !== null && q < 0) { quantity = 0; flags.push("Negative quantity set to 0"); }
    const u = norm(unitRaw);
    let unit = UNITS[u] ?? (u === "" ? "nos" : "");
    if (!unit) { unit = "nos"; flags.push(`Unit "${unitRaw}" is not a standard unit – set to nos`); }
    else if (!unitRaw) flags.push("No unit given – set to nos");
    const name = itemText || spec;
    result.items.push({
      sheet: ws.name, row: r, sl, section, category: fixturesSheet ? "FIXTURES" : pickCategory(section, name, ws.name), item: name.slice(0, 200),
      specification: itemText && spec ? spec : "", unit, quantity: Math.round(quantity * 1000) / 1000, rate: rate !== null && rate > 0 ? rate : null,
      remarks: cols.remarks ? textAt(r, cols.remarks) : "", flags,
    });
  }
  if (!result.items.length) return null;
  if (result.items.length >= 2000) result.warnings.push("Very large sheet: only the first 2000 rows should be imported at once.");
  if (!cols.unit) result.warnings.push("No Unit column found – all units set to nos. Please check.");
  return result;
}
