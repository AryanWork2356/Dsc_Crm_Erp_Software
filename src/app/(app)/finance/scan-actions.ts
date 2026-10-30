"use server";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { rateLimit } from "@/lib/rate-limit";
import { readBillFile } from "@/lib/bill-file";
import { BillReadError, billReadingOn, readBill } from "@/lib/bill-reader";

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * "Read the bill": returns the values to put in the form boxes. It saves nothing. The person looks at every box, fixes what is wrong and
 * presses Save, so a misread amount can never go into the books by itself. Boxes the reader was unsure about come back in `unsure`.
 */
export async function scanBill(fd: FormData) {
  return run(async () => {
    const kind = fd.get("kind") === "vendor_bill" ? "vendor_bill" : "expense";
    const c = await assertPerm(kind === "vendor_bill" ? "vendor_bills:create" : "expenses:create");
    if (!billReadingOn()) throw new UserError("Reading bills is not switched on yet. Please type the details; the photo is still saved with the bill.");
    if (!rateLimit(`scan:${c.userId}`, 40, 60 * 60 * 1000)) throw new UserError("You have scanned many bills in the last hour. Please wait a little, or type this one.");
    const file = await readBillFile(fd);
    if (!file) throw new UserError("Choose a photo or PDF of the bill first.");

    let r;
    try {
      r = await readBill(file.bytes, file.mime);
    } catch (e) {
      if (e instanceof BillReadError) throw new UserError(e.message);
      throw e;
    }
    await audit(c, { action: "SCAN", entityType: kind === "vendor_bill" ? "VendorBill" : "Expense", summary: `Read a bill photo (${kind === "vendor_bill" ? "vendor bill" : "expense"})` });
    if (!r.isBill) throw new UserError("This does not look like a bill or receipt. Please choose the photo of the bill.");
    if (!r.readable) throw new UserError("The bill is too blurred, dark or cut off to read. Please take the photo again, closer and in good light.");

    const amount = r.totalAmount != null ? String(r.totalAmount) : "";
    let fields: Record<string, string>;
    let unsure: string[];
    let vendorName = r.vendorName;
    if (kind === "vendor_bill") {
      const vendors = await db.vendor.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, gstin: true } });
      // the vendor: by GSTIN, then by name; with the free reader, also by looking for a known vendor anywhere in the text of the bill
      const text = r.text ?? "";
      const flat = letters(text);
      const hit = (r.vendorGstin && vendors.find((v) => v.gstin?.toUpperCase() === r.vendorGstin))
        || (r.vendorName && letters(r.vendorName).length >= 4 ? vendors.find((v) => letters(v.name).includes(letters(r.vendorName!)) || letters(r.vendorName!).includes(letters(v.name))) : undefined)
        || (text ? vendors.find((v) => (v.gstin && text.toUpperCase().includes(v.gstin.toUpperCase())) || (letters(v.name).length >= 5 && flat.includes(letters(v.name)))) : undefined);
      fields = { vendorId: hit?.id ?? "", number: r.billNumber ?? "", billDate: r.billDate ?? "", dueDate: r.dueDate ?? "", amount, notes: r.description ?? "" };
      unsure = r.unsure.map((u) => ({ vendorName: "vendorId", billNumber: "number", totalAmount: "amount", description: "notes" } as Record<string, string>)[u] ?? u);
      if (!hit && r.vendorName) unsure.push("vendorId");
      if (hit) vendorName = hit.name;
    } else {
      fields = { description: r.description ?? r.vendorName ?? "", amount, date: r.billDate ?? "", category: r.category, reference: r.billNumber ?? "" };
      unsure = r.unsure.map((u) => ({ billNumber: "reference", billDate: "date", totalAmount: "amount" } as Record<string, string>)[u] ?? u);
    }
    return { message: "Filled in from the bill. Please check every box before saving.", data: { fields, unsure: [...new Set(unsure)], handwritten: r.handwritten, note: r.note, vendorName } };
  });
}
