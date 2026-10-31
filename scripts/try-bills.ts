/**
 * Try the bill reader on real bills before switching it on for everyone. Changes nothing, saves nothing.
 *   1. put ANTHROPIC_API_KEY="..." in .env (this PC only)
 *   2. put bill photos / PDFs in D:\DSC_Crm_Softw\bill-test (or pass another folder)
 *   3. npm run try:bills
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { readBill, billModel } from "../src/lib/bill-reader";

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" };
const folder = process.argv[2] ?? "D:\\DSC_Crm_Softw\\bill-test";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.log("No ANTHROPIC_API_KEY in .env yet."); return; }
  const files = readdirSync(folder).filter((f) => MIME[extname(f).toLowerCase()]);
  if (!files.length) { console.log(`No bill photos (jpg, png, webp, pdf) in ${folder}`); return; }
  console.log(`Reading ${files.length} bill(s) with ${billModel()}\n`);
  for (const f of files) {
    const t = Date.now();
    try {
      const b = await readBill(readFileSync(join(folder, f)), MIME[extname(f).toLowerCase()]);
      console.log(`== ${f}  (${((Date.now() - t) / 1000).toFixed(1)} s)`);
      console.log(`   Vendor:  ${b.vendorName ?? "-"}   GSTIN: ${b.vendorGstin ?? "-"}`);
      console.log(`   Bill no: ${b.billNumber ?? "-"}   Date: ${b.billDate ?? "-"}   Due: ${b.dueDate ?? "-"}`);
      console.log(`   Amount:  ${b.totalAmount ?? "-"}   Type: ${b.category}   Handwritten: ${b.handwritten ? "yes" : "no"}`);
      console.log(`   What:    ${b.description ?? "-"}`);
      if (b.unsure.length) console.log(`   Unsure:  ${b.unsure.join(", ")}`);
      if (!b.isBill) console.log("   (does not look like a bill)");
      if (!b.readable) console.log("   (too unclear to read)");
      if (b.note) console.log(`   Note:    ${b.note}`);
    } catch (e) {
      console.log(`== ${f}: ${(e as Error).message}`);
    }
    console.log("");
  }
}
main();
