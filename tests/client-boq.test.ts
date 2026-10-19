import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { readClientBoq } from "@/lib/boq-reader";
import { createBoq, importClientBoq, previewClientBoq, saveBoqItems } from "@/app/(app)/sales/boq/actions";
import { createQuotationFromBoq } from "@/app/(app)/sales/quotations/actions";
import { GET as quotationExcel } from "@/app/(app)/sales/quotations/[id]/export/route";

beforeEach(() => logout());

/** A workbook laid out the way clients really send them: several sheets, a title block, section headings, subtotals, a two-row header. */
async function clientWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Civil and Interiors BOQ");
  a.addRow(["QUOTATION"]);
  a.addRow(["To, Acme Retail Pvt Ltd"]);
  a.addRow([]);
  a.addRow(["Sl. No.", "WORK TITLE", "DETAILED SPECIFICATION", "UOM", "Quantity", "Rate", "Amount"]);
  a.addRow(["A", "Demolition Works"]);
  a.addRow(["A-1", "Floor breaking", "Remove existing flooring", "Sq ft", 3115.5, 25, 77887.5]);
  a.addRow(["", "", "TOTAL OF A", "", "", "", 77887.5]);
  a.addRow(["B", "Flooring Works"]);
  a.addRow(["B-1", "Vitrified tile", "600x600 Avallon", "Sq. ft.", 1500, 190, 285000]);
  a.addRow(["B-2", "Tile skirting", "75mm height", "Rft", 568, 95, 53960]);
  a.addRow(["B-3", "Aluminium skirting", "", "Rft", "To be checked at site", 175, 0]);
  a.addRow(["", "SUBTOTAL - B", "", "", "", "", 338960]);
  a.addRow(["C", "Partition and panelling"]);
  a.addRow(["C-1", "GI framework", "50x50 channel", "Sq ft", 1036, null, null]);
  a.addRow(["", "GST @ 18%", "", "", "", "", 1]);
  const e = wb.addWorksheet("ELECTRICAL");
  e.addRow(["ELECTRICAL BOQ"]);
  e.addRow(["SL No", "Particulars", "Unit", "Qty", "", "", "Remark"]);
  e.addRow(["", "", "", "", "Rate", "Amount", ""]); // the second header row
  e.addRow([1, "FRLS wiring", "Sqft", 1648, 300, 494400, ""]);
  e.addRow([2, "Camera Cat 6 cable", "Mtr", 283, 110, 31130, "per drawing"]);
  e.addRow(["", "Total", "", "", "", 525530, ""]);
  const notes = wb.addWorksheet("Notes");
  notes.addRow(["Terms and conditions"]);
  notes.addRow(["Payment 50% advance"]);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe("reading a client's BOQ, whatever its layout", () => {
  it("finds the table on every sheet, sections, rates and the two-row header; ignores totals, GST lines and notes", async () => {
    const sheets = await readClientBoq(await clientWorkbook());
    expect(sheets.map((s) => s.name)).toEqual(["Civil and Interiors BOQ", "ELECTRICAL"]); // "Notes" has no table
    const civil = sheets[0];
    expect(civil.headerRow).toBe(4);
    expect(civil.columns).toMatchObject({ Description: "B", Specification: "C", Unit: "D", Quantity: "E", Rate: "F" });
    expect(civil.items.map((i) => i.item)).toEqual(["Floor breaking", "Vitrified tile", "Tile skirting", "Aluminium skirting", "GI framework"]);
    expect(civil.items[1]).toMatchObject({ sl: "B-1", category: "FLOORING", unit: "sqft", quantity: 1500, rate: 190, specification: "600x600 Avallon" });
    expect(civil.items[2].unit).toBe("rft");
    expect(civil.items[0].category).toBe("CIVIL"); // heading "Demolition Works"
    expect(civil.items[4].category).toBe("CARPENTRY"); // heading "Partition and panelling"
    expect(civil.sections).toEqual(["Demolition Works", "Flooring Works", "Partition and panelling"]);
    expect(civil.skipped).toBeGreaterThanOrEqual(3); // TOTAL OF A, SUBTOTAL - B, GST line

    const alu = civil.items[3];
    expect(alu.quantity).toBe(0);
    expect(alu.flags.join(" ")).toMatch(/not a number/);
    expect(civil.items[4].rate).toBeNull(); // the client left the rate blank

    const el = sheets[1];
    expect(el.headerRow).toBe(2);
    expect(el.columns).toMatchObject({ Description: "B", Unit: "C", Quantity: "D", Rate: "E" }); // rate found on the second header row
    expect(el.items).toHaveLength(2);
    expect(el.items[0]).toMatchObject({ category: "ELECTRICAL", unit: "sqft", quantity: 1648, rate: 300 });
    expect(el.items[1]).toMatchObject({ unit: "rmt", remarks: "per drawing" });
  });

  it("returns nothing for a file with no BOQ table", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Letter").addRow(["Dear sir, please find attached"]);
    expect(await readClientBoq(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer))).toEqual([]);
  });
});

describe("importing it into a BOQ, then quoting", () => {
  let boqId = "";
  const upload = async (extra: Record<string, string> = {}) => {
    const f = fd(extra);
    f.set("file", new File([new Uint8Array(await clientWorkbook())], "client-boq.xlsx"));
    return f;
  };

  it("previews first and saves nothing", async () => {
    await loginAs("designer@dsc.demo");
    const created = await createBoq(fd({ title: "Client BOQ import test" }));
    boqId = (created as { data: { id: string } }).data.id;
    const r = await previewClientBoq(await upload());
    expect(r.ok).toBe(true);
    const sheets = (r as unknown as { data: { sheets: { name: string; count: number; flagged: number }[] } }).data.sheets;
    expect(sheets.map((s) => [s.name, s.count])).toEqual([["Civil and Interiors BOQ", 5], ["ELECTRICAL", 2]]);
    expect(sheets[0].flagged).toBeGreaterThan(0);
    expect(await db.boqItem.count({ where: { boqId } })).toBe(0);
    const bad = fd({});
    bad.set("file", new File(["x"], "boq.pdf"));
    expect((await previewClientBoq(bad)).ok).toBe(false); // wrong file type
    expect((await previewClientBoq(fd({}))).ok).toBe(false); // no file
  });

  it("imports the chosen sheets, keeping the client's rates only when asked", async () => {
    await loginAs("designer@dsc.demo");
    expect((await importClientBoq(boqId, await upload({ sheets: "" }))).ok).toBe(false); // nothing ticked
    expect((await importClientBoq(boqId, await upload({ sheets: "ELECTRICAL" }))).ok).toBe(true);
    let items = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    expect(items.map((i) => i.item)).toEqual(["FRLS wiring", "Camera Cat 6 cable"]);
    expect(items.every((i) => Number(i.sellingRate) === 0)).toBe(true); // rates stay empty for DSC to fill in
    expect(Number(items[0].quantity)).toBe(1648);

    expect((await importClientBoq(boqId, await upload({ sheets: "Civil and Interiors BOQ|ELECTRICAL", mode: "replace", keepRates: "on" }))).ok).toBe(true);
    items = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    expect(items).toHaveLength(7);
    const tile = items.find((i) => i.item === "Vitrified tile")!;
    expect(Number(tile.sellingRate)).toBe(190);
    expect(Number(tile.total)).toBe(285000);
    expect(items.find((i) => i.item === "Aluminium skirting")!.description).toMatch(/not a number/);
  });

  it("only drafts can be imported into, and only people who edit BOQs", async () => {
    await loginAs("sales@dsc.demo"); // sales can view BOQs, not edit them
    expect((await importClientBoq(boqId, await upload({ sheets: "ELECTRICAL" }))).ok).toBe(false);
    await loginAs("designer@dsc.demo");
    await db.boq.update({ where: { id: boqId }, data: { status: "APPROVED" } });
    expect((await importClientBoq(boqId, await upload({ sheets: "ELECTRICAL" }))).ok).toBe(false);
    await db.boq.update({ where: { id: boqId }, data: { status: "DRAFT" } });
  });

  it("a quotation from that BOQ exports to Excel with the DSC letterhead, summary, GST split and live formulas", async () => {
    await loginAs("designer@dsc.demo");
    const items = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    // price the rows the client left blank, as DSC would on the BOQ screen
    const body = items.map((i) => ({ id: i.id, category: i.category, item: i.item, specification: i.specification ?? "", unit: i.unit, quantity: Number(i.quantity), sellingRate: Number(i.sellingRate) || 100, materialCost: 0, labourCost: 0, otherCost: 0 }));
    expect((await saveBoqItems(boqId, JSON.stringify(body))).ok).toBe(true);
    await loginAs("owner@dsc.demo");
    const client = await db.client.findFirstOrThrow({});
    expect((await createQuotationFromBoq(boqId, fd({ clientId: client.id }))).ok).toBe(true);
    const quote = await db.quotation.findFirstOrThrow({ where: { boqId }, include: { items: true } });

    const res = await quotationExcel(new NextRequest("http://x"), { params: Promise.resolve({ id: quote.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain(`${quote.number}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Quotation", "BOQ details"]);
    const q1 = wb.getWorksheet("Quotation")!;
    const settings = await db.companySettings.findFirstOrThrow();
    expect(String(q1.getCell("B1").value)).toBe(settings.legalName); // letterhead
    expect(String(q1.getCell("B4").value)).toContain(settings.gstin!);
    expect(q1.getImages().length).toBe(1); // the logo
    expect(q1.getCell("A7").value).toBe("QUOTATION");
    const texts: string[] = [];
    q1.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string") texts.push(cell.value); }));
    expect(texts).toContain("SUMMARY OF WORK");
    expect(texts.some((t) => t === "GRAND TOTAL")).toBe(true);
    expect(texts.some((t) => /CGST @ 9%|IGST @ 18%/.test(t))).toBe(true);
    expect(texts.some((t) => t.startsWith("Amount in words:"))).toBe(true);
    expect(texts.some((t) => /50% advance/.test(t))).toBe(true); // payment terms
    let grand = 0;
    q1.eachRow((row) => { if (row.getCell(2).value === "GRAND TOTAL") grand = Number((row.getCell(7).value as { result: number }).result); });
    expect(grand).toBeCloseTo(Number(quote.total), 2); // same number as the app
    const d = wb.getWorksheet("BOQ details")!;
    let formulas = 0;
    d.eachRow((row) => { const v = row.getCell(7).value; if (v && typeof v === "object" && "formula" in v && String(v.formula).startsWith("ROUND(D")) formulas++; });
    expect(formulas).toBe(quote.items.length); // every amount is a live formula the client can edit
  });

  it("clients, vendors and people without quotation access cannot download it", async () => {
    const quote = await db.quotation.findFirstOrThrow({ where: { boqId } });
    const call = () => quotationExcel(new NextRequest("http://x"), { params: Promise.resolve({ id: quote.id }) });
    await loginAs("client@dsc.demo");
    expect((await call()).status).toBe(403);
    await loginAs("vendor@dsc.demo");
    expect((await call()).status).toBe(403);
    await loginAs("supervisor@dsc.demo");
    expect((await call()).status).toBe(403);
    logout();
    expect((await call()).status).toBe(403);
  });
});
