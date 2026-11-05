/**
 * Puts the company's supplier list (Excel) into the Vendors list, with the kind of work each one does (so a project's dropdown for
 * "Electrical" offers only electricians). Safe to run twice: a vendor that already exists (same name or same GSTIN) is NOT duplicated
 * and nothing already written is overwritten; only missing details and missing kinds of work are added.
 *
 *   npx tsx scripts/import-vendors.ts "<excel file>" local --dry-run     this computer's database, shows what would happen
 *   npx tsx scripts/import-vendors.ts "<excel file>" new                 the ONLINE database named in .env.new
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { nextNumber } from "../src/lib/sequence";
import { TRADES, vendorTrades, type TradeKey } from "../src/lib/trades";

const [file, target = "local"] = process.argv.slice(2);
const dry = process.argv.includes("--dry-run");

function envFile(name: string): Record<string, string> {
  const f = path.join(process.cwd(), name);
  if (!fs.existsSync(f)) throw new Error(`${name} was not found.`);
  return Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
}
const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text ?? "").trim();
  if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result ?? "").trim();
  return String(v).replace(/\s+/g, " ").trim();
};
const norm = (s: string) => s.toLowerCase().replace(/\b(pvt|ltd|private|limited|llp|co|company|enterprises?|traders?)\b/g, "").replace(/[^a-z0-9]/g, "");

type Row = { name: string; person: string; phone: string; whatsapp: string; address: string; gstin: string; category: string; notes: string[] };

async function readSheet(): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const rows: Row[] = [];
  const byName = new Map<string, Row>();
  // Sheet 2 has the details (category, person, company, phone, address, GST). Sheet 1 is just a numbered list of names.
  const detail = wb.worksheets.find((w) => /category|catogaory/i.test(text(w.getRow(2).getCell(2).value))) ?? wb.worksheets[1];
  detail.eachRow({ includeEmpty: false }, (r, n) => {
    if (n < 3) return;
    const [category, person, company, contact, address, gst] = [2, 3, 4, 5, 6, 7].map((i) => text(r.getCell(i).value));
    const name = company || person;
    if (!name) return;
    const notes: string[] = [];
    const phones = contact.split(/[\/,;]| and /i).map((p) => p.replace(/[^\d+ ]/g, "").trim()).filter((p) => p.replace(/\D/g, "").length >= 6);
    if (phones.length > 1) notes.push(`Other phone: ${phones.slice(1).join(", ")}`);
    const g = gst.replace(/\s+/g, "").toUpperCase();
    const row: Row = { name, person: company ? person : "", phone: phones[0] ?? "", whatsapp: "", address: address.replace(/\s*\n\s*/g, ", "), gstin: /^[0-9A-Z]{15}$/.test(g) ? g : "", category, notes };
    if (g && !row.gstin) notes.push(`GSTIN in the list looks wrong: ${gst}`);
    rows.push(row); byName.set(norm(name), row);
  });
  // names that are only in the first sheet: added with the kind of work read from the name (e.g. "J K Steel", "Aarch Ply")
  const list = wb.worksheets.find((w) => w !== detail);
  list?.eachRow({ includeEmpty: false }, (r, n) => {
    if (n < 4) return;
    const name = text(r.getCell(3).value);
    if (name && !byName.has(norm(name)) && ![...byName.keys()].some((k) => k && (k.includes(norm(name)) || norm(name).includes(k)))) {
      rows.push({ name, person: "", phone: "", whatsapp: "", address: "", gstin: "", category: "", notes: ["From the supplier list (no details given). Please add phone and address."] });
    }
  });
  return rows;
}

async function main() {
  if (!file || !fs.existsSync(file)) throw new Error("Give the Excel file.");
  let prisma: PrismaClient;
  let where: string;
  if (target === "new") {
    const url = envFile(".env.new").DATABASE_URL.replace(/[&?]channel_binding=require/, "");
    prisma = new PrismaClient({ datasourceUrl: url });
    where = `ONLINE ${new URL(url).hostname}`;
  } else {
    const url = process.env.DATABASE_URL ?? envFile(".env").DATABASE_URL;
    if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("local means this computer's database; the address in .env is not local.");
    prisma = new PrismaClient({ datasourceUrl: url });
    where = "this computer's database";
  }
  const rows = await readSheet();
  const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const existing = await prisma.vendor.findMany({ where: { companyId: company.id, deletedAt: null } });
  let created = 0, updated = 0, same = 0;
  const added: string[] = [];
  const perTrade: Record<string, number> = {};
  const seenGst = new Map<string, string>(existing.filter((v) => v.gstin).map((v) => [v.gstin!, v.name]));
  for (const r of rows) {
    const kinds = new Set<TradeKey>([...vendorTrades(r.category), ...(r.category ? [] : vendorTrades(r.name))]);
    const gstTaken = r.gstin && seenGst.get(r.gstin) && norm(seenGst.get(r.gstin)!) !== norm(r.name);
    if (gstTaken) { r.notes.push(`The GSTIN in the list (${r.gstin}) is the same as ${seenGst.get(r.gstin)}. Please check it.`); r.gstin = ""; }
    const match = existing.find((v) => norm(v.name) === norm(r.name) || (r.gstin && v.gstin === r.gstin));
    const labels = (set: Set<TradeKey>) => TRADES.filter((t) => set.has(t.key)).map((t) => t.label).join(", ");
    if (match) {
      const have = new Set(vendorTrades(match.trades));
      const merged = new Set<TradeKey>([...have, ...kinds]);
      const patch: Record<string, unknown> = {};
      if (merged.size !== have.size) patch.trades = labels(merged);
      if (!match.contactPerson && r.person) patch.contactPerson = r.person;
      if (!match.phone && r.phone) patch.phone = r.phone;
      if (!match.address && r.address) patch.address = r.address;
      if (!match.gstin && r.gstin) patch.gstin = r.gstin;
      if (!match.categories && r.category) patch.categories = r.category;
      if (Object.keys(patch).length) { updated++; if (!dry) await prisma.vendor.update({ where: { id: match.id }, data: patch }); } else same++;
      for (const k of kinds) perTrade[k] = (perTrade[k] ?? 0) + 1;
      continue;
    }
    if (r.gstin) seenGst.set(r.gstin, r.name);
    created++; added.push(r.name);
    for (const k of kinds) perTrade[k] = (perTrade[k] ?? 0) + 1;
    if (!dry) {
      await prisma.$transaction(async (tx) => {
        let code = await nextNumber(tx, company.id, "V");
        while (await tx.vendor.findFirst({ where: { companyId: company.id, code } })) code = await nextNumber(tx, company.id, "V");
        await tx.vendor.create({ data: { companyId: company.id, code, name: r.name, contactPerson: r.person || null, phone: r.phone || null, address: r.address || null, gstin: r.gstin || null, categories: r.category || null, trades: labels(kinds) || null, notes: r.notes.join(" · ") || null } });
      });
    }
  }
  console.log(`${dry ? "DRY RUN (nothing saved) on" : "DONE on"} ${where}: ${rows.length} suppliers in the file → ${created} new, ${updated} existing ones updated, ${same} already complete.`);
  console.log("Kinds of work covered: " + Object.entries(perTrade).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${TRADES.find((t) => t.key === k)?.label} ${n}`).join(", "));
  const none = rows.filter((r) => ![...vendorTrades(r.category), ...(r.category ? [] : vendorTrades(r.name))].length).map((r) => r.name);
  if (none.length) console.log(`No kind of work could be read for: ${none.join("; ")}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("STOPPED:", e instanceof Error ? e.message : e); process.exitCode = 1; });
