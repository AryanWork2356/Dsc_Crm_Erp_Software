import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs, logout, fd } from "./setup";
import { canOpenDocument } from "@/lib/doc-access";
import { cleanBill, cleanDate, type CleanBill, type RawBill } from "@/lib/bill-reader";
import { scanBill } from "@/app/(app)/finance/scan-actions";
import { createExpense, createVendorBill } from "@/app/(app)/finance/actions";

vi.mock("@/lib/bill-reader", async (orig) => ({ ...(await orig<typeof import("@/lib/bill-reader")>()), readBill: vi.fn() }));
import { readBill } from "@/lib/bill-reader";
const readBillMock = vi.mocked(readBill);

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const bill = (name = "bill.jpg") => new File([JPG], name, { type: "image/jpeg" });
const withFile = (o: Record<string, string>, f: File | null = bill()) => { const x = fd(o); if (f) x.set("billFile", f); return x; };
const read = (o: Partial<CleanBill> = {}): CleanBill => ({ isBill: true, readable: true, handwritten: false, vendorName: "Sharma Hardware", vendorGstin: null, billNumber: "4471", billDate: "2026-11-09", dueDate: null, totalAmount: 1850, description: "Fevicol, screws, sandpaper", category: "MATERIAL", unsure: [], note: null, ...o });
const tag = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4);

beforeEach(() => { logout(); readBillMock.mockReset(); process.env.ANTHROPIC_API_KEY = "test-key"; });
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });

describe("cleaning what the reader returns", () => {
  const raw = (o: Partial<RawBill> = {}): RawBill => ({ isBill: true, readable: true, handwritten: false, vendorName: "  Shree  Ply ", vendorGstin: "27abcps2101a1zf", billNumber: " SPL/1184 ", billDate: "2026-11-16", dueDate: "2026-02-30", totalAmount: 244684.8, taxAmount: 37324.8, description: "Plywood", category: "MATERIAL", unsure: [], note: null, ...o });
  it("keeps believable values and tidies them", () => {
    const c = cleanBill(raw(), new Date("2026-11-20"));
    expect(c).toMatchObject({ vendorName: "Shree Ply", vendorGstin: "27ABCPS2101A1ZF", billNumber: "SPL/1184", billDate: "2026-11-16", totalAmount: 244684.8 });
  });
  it("drops an impossible date, a bad GSTIN and a silly amount, and says the box needs a person", () => {
    const c = cleanBill(raw({ vendorGstin: "NOT-A-GSTIN", totalAmount: -50 }), new Date("2026-11-20"));
    expect(c.dueDate).toBeNull();
    expect(c.vendorGstin).toBeNull();
    expect(c.totalAmount).toBeNull();
    expect(c.unsure).toEqual(expect.arrayContaining(["dueDate", "totalAmount"]));
    expect(cleanDate("1999-01-01", new Date("2026-11-20"))).toBeNull(); // bills are not from 1999
    expect(cleanDate("2026-13-01")).toBeNull();
  });
});

describe("reading a bill (never saves anything)", () => {
  it("is for people who may log expenses; the store cannot", async () => {
    await loginAs("store@dsc.demo");
    expect((await scanBill(withFile({ kind: "expense" }))).ok).toBe(false);
    expect(readBillMock).not.toHaveBeenCalled();
  });

  it("is switched off, with a friendly message, until a key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await loginAs("supervisor@dsc.demo");
    const r = await scanBill(withFile({ kind: "expense" }));
    expect(r.ok === false && r.error).toMatch(/not switched on/);
    expect(readBillMock).not.toHaveBeenCalled();
  });

  it("returns the values for an expense, and flags what the reader was unsure about", async () => {
    await loginAs("supervisor@dsc.demo");
    readBillMock.mockResolvedValue(read({ unsure: ["totalAmount"], handwritten: true }));
    const before = await db.expense.count();
    const r = await scanBill(withFile({ kind: "expense" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as { fields: Record<string, string>; unsure: string[]; handwritten: boolean };
      expect(d.fields).toMatchObject({ description: "Fevicol, screws, sandpaper", amount: "1850", date: "2026-11-09", category: "MATERIAL", reference: "4471" });
      expect(d.unsure).toContain("amount");
      expect(d.handwritten).toBe(true);
    }
    expect(await db.expense.count()).toBe(before); // nothing was saved
  });

  it("for a vendor bill, finds the vendor by GSTIN, then by name", async () => {
    await loginAs("accounts@dsc.demo");
    const company = await db.company.findFirstOrThrow();
    const v = await db.vendor.create({ data: { companyId: company.id, code: `V-S${tag()}`, name: `Shree Ply ${tag()}`, gstin: "27ABCPS2101A1ZF" } });
    readBillMock.mockResolvedValue(read({ vendorName: "SHREE PLY AND LAMINATES", vendorGstin: "27ABCPS2101A1ZF", billNumber: "SPL/26-27/1184", dueDate: "2026-12-16", totalAmount: 244684.8 }));
    let r = await scanBill(withFile({ kind: "vendor_bill" }));
    expect(r.ok && (r.data as { fields: Record<string, string> }).fields).toMatchObject({ vendorId: v.id, number: "SPL/26-27/1184", amount: "244684.8", dueDate: "2026-12-16" });
    readBillMock.mockResolvedValue(read({ vendorName: v.name, vendorGstin: null }));
    r = await scanBill(withFile({ kind: "vendor_bill" }));
    expect(r.ok && (r.data as { fields: Record<string, string> }).fields.vendorId).toBe(v.id);
    readBillMock.mockResolvedValue(read({ vendorName: "Unknown Traders", vendorGstin: null }));
    r = await scanBill(withFile({ kind: "vendor_bill" }));
    expect(r.ok && (r.data as { fields: Record<string, string>; unsure: string[] })).toMatchObject({ fields: { vendorId: "" } });
  });

  it("refuses a picture that is not a bill, one that is unreadable, and a file of the wrong kind", async () => {
    await loginAs("supervisor@dsc.demo");
    readBillMock.mockResolvedValue(read({ isBill: false }));
    expect((await scanBill(withFile({ kind: "expense" }))).ok).toBe(false);
    readBillMock.mockResolvedValue(read({ readable: false }));
    const r = await scanBill(withFile({ kind: "expense" }));
    expect(r.ok === false && r.error).toMatch(/too blurred/);
    expect((await scanBill(withFile({ kind: "expense" }, new File([JPG], "bill.exe")))).ok).toBe(false);
    expect((await scanBill(withFile({ kind: "expense" }, null))).ok).toBe(false);
  });

  it("limits how many bills one person can read in an hour", async () => {
    await loginAs("hr@dsc.demo");
    // HR may not log expenses, so use a person who can and has not read any yet
    await loginAs("pm@dsc.demo");
    readBillMock.mockResolvedValue(read());
    let last = true;
    for (let i = 0; i < 42; i++) last = (await scanBill(withFile({ kind: "expense" }))).ok;
    expect(last).toBe(false);
  });
});

describe("the bill file is stored with the record, and only the right people can open it", () => {
  it("an expense keeps its bill; the person who logged it and finance can open it, the store cannot", async () => {
    const sup = await loginAs("supervisor@dsc.demo");
    const r = await createExpense(withFile({ description: `Bill test ${tag()}`, amount: "1850", date: "2026-10-29", category: "MATERIAL" }));
    expect(r.ok).toBe(true);
    const e = await db.expense.findFirstOrThrow({ where: { createdById: sup.id }, orderBy: { createdAt: "desc" } });
    const doc = await db.document.findFirstOrThrow({ where: { entityType: "EXPENSE", entityId: e.id } });
    expect(doc).toMatchObject({ type: "BILL", mimeType: "image/jpeg", uploadedById: sup.id });
    expect(await canOpenDocument((await getCtx())!, doc)).toBe(true);
    await loginAs("accounts@dsc.demo");
    expect(await canOpenDocument((await getCtx())!, doc)).toBe(true);
    await loginAs("store@dsc.demo");
    expect(await canOpenDocument((await getCtx())!, doc)).toBe(false);
  });

  it("an expense can still be saved without a bill, and a wrong file type is refused before anything is saved", async () => {
    await loginAs("supervisor@dsc.demo");
    expect((await createExpense(withFile({ description: `No bill ${tag()}`, amount: "50", date: "2026-10-29", category: "MISC" }, null))).ok).toBe(true);
    const before = await db.expense.count();
    expect((await createExpense(withFile({ description: `Bad file ${tag()}`, amount: "50", date: "2026-10-29", category: "MISC" }, new File([JPG], "notes.docx")))).ok).toBe(false);
    expect(await db.expense.count()).toBe(before);
  });

  it("a vendor bill keeps its bill file for procurement and accounts, not for the site", async () => {
    await loginAs("accounts@dsc.demo");
    const v = await db.vendor.findFirstOrThrow({ where: { deletedAt: null } });
    const number = `BL-${tag()}`;
    expect((await createVendorBill(withFile({ vendorId: v.id, number, billDate: "2026-10-29", amount: "7777.77" }))).ok).toBe(true);
    const b = await db.vendorBill.findFirstOrThrow({ where: { number, vendorId: v.id } });
    const doc = await db.document.findFirstOrThrow({ where: { entityType: "VENDOR_BILL", entityId: b.id } });
    expect(await canOpenDocument((await getCtx())!, doc)).toBe(true);
    await loginAs("procurement@dsc.demo");
    expect(await canOpenDocument((await getCtx())!, doc)).toBe(true);
    await loginAs("supervisor@dsc.demo");
    expect(await canOpenDocument((await getCtx())!, doc)).toBe(false);
  });
});
