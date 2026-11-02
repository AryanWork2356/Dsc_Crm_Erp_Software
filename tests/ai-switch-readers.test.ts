import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs, logout, fd } from "./setup";

vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), aiJson: vi.fn(), aiText: vi.fn() }));
import { aiJson, aiText, aiActive, canControlAi } from "@/lib/ai";
import { setAiEnabled } from "@/app/(app)/settings/ai/actions";
import { fixSpelling, voiceToEnglish } from "@/app/(app)/ai-actions";
import { materialsFromSpeech } from "@/app/(app)/procurement/ai-actions";
import { createPurchaseRequest } from "@/app/(app)/procurement/actions";
import { ask } from "@/app/(app)/ask/actions";
import { scanBill } from "@/app/(app)/finance/scan-actions";
import { runEveningSummary } from "@/lib/site-summary";
import { billReadingOn } from "@/lib/bill-reader";
import { sheetToText } from "@/lib/sheet-text";
import { readChallan } from "@/app/(app)/inventory/ai-actions";
import { readClientPO } from "@/app/(app)/crm/clients/po-actions";
import { readBoqPaper } from "@/app/(app)/sales/boq/ai-actions";
import { previewClientBoq } from "@/app/(app)/sales/boq/actions";

const aiJsonMock = vi.mocked(aiJson);
const aiTextMock = vi.mocked(aiText);
const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`;
const jpg = (name = "paper.jpg") => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])], name, { type: "image/jpeg" });
const webm = () => new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01])], "voice.webm", { type: "audio/webm" });
async function xlsx(rows: (string | number)[][], name = "bill.xlsx") {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Sheet1"); rows.forEach((r) => ws.addRow(r));
  return new File([new Uint8Array(await wb.xlsx.writeBuffer())], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
async function setSwitch(on: boolean) {
  const company = await db.company.findFirstOrThrow();
  await db.companySettings.update({ where: { companyId: company.id }, data: { aiEnabled: on } });
  return company;
}

beforeEach(() => { logout(); aiJsonMock.mockReset(); aiTextMock.mockReset(); process.env.GEMINI_API_KEY = "g"; delete process.env.ANTHROPIC_API_KEY; delete process.env.AI_PROVIDER; });
afterEach(async () => { await setSwitch(true); delete process.env.GEMINI_API_KEY; });

describe("the AI master switch", () => {
  it("only Aryan Shetty and Rupesh Sharma, as Owners, can flip it", async () => {
    expect(canControlAi({ role: "OWNER", name: "Aryan Shetty" })).toBe(true);
    expect(canControlAi({ role: "OWNER", name: "  rupesh   sharma " })).toBe(true);
    expect(canControlAi({ role: "OWNER", name: "Dinesh Sharma" })).toBe(false);
    expect(canControlAi({ role: "MANAGEMENT", name: "Aryan Shetty" })).toBe(false);
    expect(canControlAi({ role: "ADMIN", name: "Rupesh Sharma" })).toBe(false);
    await loginAs("dinesh@dsc.demo"); // an Owner, but not one of the two
    expect((await setAiEnabled(false)).ok).toBe(false);
    await loginAs("director@dsc.demo");
    expect((await setAiEnabled(false)).ok).toBe(false);
    await loginAs("owner@dsc.demo"); // the demo Owner login is named Rupesh Sharma
    expect(canControlAi((await getCtx())!)).toBe(true);
    expect((await setAiEnabled(false)).ok).toBe(true);
    const company = await db.company.findFirstOrThrow();
    expect(await aiActive(company.id)).toBe(false);
    expect((await setAiEnabled(true)).ok).toBe(true);
    expect(await aiActive(company.id)).toBe(true);
  });

  it("OFF: every AI feature refuses and nothing is sent to the AI; no key means off too", async () => {
    const company = await setSwitch(false);
    await loginAs("supervisor@dsc.demo");
    expect((await fixSpelling("tils not arived")).ok).toBe(false);
    expect((await materialsFromSpeech("20 sheet plywood")).ok).toBe(false);
    await loginAs("director@dsc.demo");
    expect((await ask([{ role: "user", text: "What happened today?" }])).ok).toBe(false);
    expect(await billReadingOn(company.id)).toBe(false);
    const bill = fd({ kind: "vendor_bill" }); bill.set("billFile", jpg("bill.jpg"));
    await loginAs("accounts@dsc.demo");
    expect((await scanBill(bill)).ok).toBe(false);
    expect((await runEveningSummary(company.id)).sent).toBe(false);
    expect(aiJsonMock).not.toHaveBeenCalled();
    expect(aiTextMock).not.toHaveBeenCalled();
    await setSwitch(true);
    delete process.env.GEMINI_API_KEY;
    expect(await aiActive(company.id)).toBe(false); // switched on, but no key: still nothing shows
  });
});

describe("Excel bills", () => {
  it("a spreadsheet becomes text the AI reads, and the bill form fills from it", async () => {
    const file = await xlsx([["Shree Hardware", "", "Invoice", "SH/221"], ["Date", "05/10/2026"], ["Item", "Qty", "Rate", "Amount"], ["Hinge soft close", 40, 120, 4800], ["", "", "Total", 5664]]);
    const text = await sheetToText(Buffer.from(await file.arrayBuffer()), file.type);
    expect(text).toContain("Hinge soft close | 40 | 120 | 4800");
    aiJsonMock.mockResolvedValue({ isBill: true, readable: true, handwritten: false, vendorName: "Shree Hardware", vendorGstin: null, billNumber: "SH/221", billDate: "2026-10-05", dueDate: null, totalAmount: 5664, taxAmount: 864, description: "Soft close hinges", category: "MATERIAL", unsure: [], note: null });
    await loginAs("accounts@dsc.demo");
    const f = fd({ kind: "expense" }); f.set("billFile", file);
    const r = await scanBill(f);
    expect(r.ok).toBe(true);
    expect((r as { data: { fields: Record<string, string> } }).data.fields).toMatchObject({ amount: "5664", reference: "SH/221" });
    expect(JSON.stringify(aiJsonMock.mock.calls[0][0].parts)).toContain("Hinge soft close");
  });
});

describe("reading papers", () => {
  it("a delivery challan fills what arrived against the order's own items, never twice, and keeps what it could not match", async () => {
    const company = await db.company.findFirstOrThrow();
    const vendor = await db.vendor.create({ data: { companyId: company.id, code: `V-CH${tag()}`, name: "Challan Ply" } });
    const po = await db.purchaseOrder.create({ data: { companyId: company.id, number: `PO-CH${tag()}`, vendorId: vendor.id, status: "SENT_TO_VENDOR", items: { create: [{ description: "18mm BWP plywood", unit: "sheet", quantity: 20, rate: 1000, amount: 20000 }, { description: "Fevicol SH 5kg", unit: "nos", quantity: 5, rate: 900, amount: 4500 }] } }, include: { items: { orderBy: { id: "asc" } } } });
    aiJsonMock.mockResolvedValue({ isChallan: true, readable: true, challanNo: "DC-778", date: "2026-10-30", vehicleNo: "MH04 AB 1234", note: null,
      lines: [{ text: "Ply 18 mm BWP", quantity: 12, unit: "sheet", orderItem: 1 }, { text: "Ply again", quantity: 3, unit: "sheet", orderItem: 1 }, { text: "Screws", quantity: 100, unit: "nos", orderItem: null }] });
    await loginAs("store@dsc.demo");
    const f = new FormData(); f.set("challanPhoto", jpg("challan.jpg"));
    const r = await readChallan(po.id, f);
    expect(r.ok).toBe(true);
    const d = (r as { data: { challanNo: string; vehicleNo: string; date: string; rows: { poItemId: string; quantity: number }[]; unmatched: string[] } }).data;
    expect(d).toMatchObject({ challanNo: "DC-778", vehicleNo: "MH04 AB 1234", date: "2026-10-30" });
    expect(d.rows).toEqual([{ poItemId: po.items[0].id, quantity: 12 }]);
    expect(d.unmatched.join(" ")).toMatch(/Ply again.*Screws/);
    await loginAs("designer@dsc.demo"); // does not receive material
    expect((await readChallan(po.id, f)).ok).toBe(false);
  });

  it("a client's PO fills number, date, value and our quotation; an unclear value is flagged", async () => {
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.create({ data: { companyId: company.id, code: `CL-PO${tag()}`, name: "PO Reader Client" } });
    const q = await db.quotation.create({ data: { companyId: company.id, number: `QT-R${tag()}`, clientId: client.id, title: "Fit-out" } });
    aiJsonMock.mockResolvedValue({ isPo: true, readable: true, number: "4500012345", date: "2026-10-20", amount: 1250000, scopes: "Civil and interiors", ourQuotationNo: q.number.toLowerCase(), unsure: [], note: null });
    await loginAs("accounts@dsc.demo");
    const f = new FormData(); f.set("file", jpg("po.jpg"));
    const r = await readClientPO(client.id, f);
    expect(r.ok).toBe(true);
    expect((r as { data: { fields: Record<string, string> } }).data.fields).toMatchObject({ number: "4500012345", poDate: "2026-10-20", amount: "1250000", quotationId: q.id });
    aiJsonMock.mockResolvedValue({ isPo: true, readable: true, number: "77", date: null, amount: null, scopes: null, ourQuotationNo: null, unsure: [], note: "Only a total with GST is printed" });
    const r2 = await readClientPO(client.id, f);
    expect((r2 as { data: { unsure: string[] } }).data.unsure).toContain("amount");
  });

  it("a BOQ PDF becomes an Excel sheet that the normal import screen reads, sections and all", async () => {
    aiJsonMock.mockResolvedValue({ isBoq: true, readable: true, note: null, rows: [
      { section: "Flooring works", sl: "1", item: "Vitrified tiles 600x600 laying", spec: "Kajaria", unit: "sqft", quantity: 850, rate: null },
      { section: "Flooring works", sl: "2", item: "Skirting 100 mm", spec: null, unit: "rft", quantity: 320, rate: 45 },
      { section: "Electrical", sl: "3", item: "Light point wiring", spec: null, unit: "nos", quantity: 64, rate: null },
    ] });
    await loginAs("director@dsc.demo");
    const f = new FormData(); f.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], "boq.pdf", { type: "application/pdf" }));
    const r = await readBoqPaper(f);
    expect(r.ok).toBe(true);
    const xl = Buffer.from((r as { data: { xlsx: string } }).data.xlsx, "base64");
    const p = new FormData(); p.set("file", new File([new Uint8Array(xl)], "boq (read by AI).xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const prev = await previewClientBoq(p);
    expect(prev.ok).toBe(true);
    const sheets = (prev as { data: { sheets: { count: number; sections: string[]; sample: { item: string; quantity: number }[] }[] } }).data.sheets;
    expect(sheets[0].count).toBe(3);
    expect(sheets[0].sections.join(" ").toLowerCase()).toContain("flooring");
    expect(sheets[0].sample[0]).toMatchObject({ item: expect.stringContaining("Vitrified"), quantity: 850 });
  });

  it("a voice note is written out in English for people who may play it, and only for them", async () => {
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    const p = await db.project.create({ data: { companyId: company.id, code: `PRJ-VT${tag()}`, name: "Voice site", clientId: client.id, status: "EXECUTION", supervisorId: sup.id } });
    await loginAs("supervisor@dsc.demo");
    const form = fd({ projectId: p.id, requiredDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10), items: JSON.stringify([{ description: "Plywood", unit: "sheet", quantity: 5 }]) });
    form.append("voice", webm());
    const pr = await createPurchaseRequest(form);
    const doc = await db.document.findFirstOrThrow({ where: { entityType: "PURCHASE_REQUEST", entityId: (pr as { data: { id: string } }).data.id } });
    aiTextMock.mockResolvedValue("We need 5 sheets of plywood by tomorrow morning.");
    const r = await voiceToEnglish(doc.id);
    expect(r.ok && (r.data as { text: string }).text).toContain("5 sheets");
    expect(aiTextMock.mock.calls[0][0].parts.some((x) => "audio" in x)).toBe(true);
    await loginAs("engineer@dsc.demo"); // not on that project
    expect((await voiceToEnglish(doc.id)).ok).toBe(false);
  });
});
