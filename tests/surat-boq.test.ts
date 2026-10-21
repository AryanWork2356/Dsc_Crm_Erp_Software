import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createBoq, importClientBoq, previewClientBoq, saveBoqItems } from "@/app/(app)/sales/boq/actions";
import { createQuotationFromBoq } from "@/app/(app)/sales/quotations/actions";
import { GET as quotationExcel } from "@/app/(app)/sales/quotations/[id]/export/route";

/**
 * Two real BOQs from Aditya Birla Fashion & Retail (Louis Philippe, Mota Varachha, Surat). They carry the client's own
 * material codes and HSN/SAC codes and have NO rates: DSC prices them. Skipped on a machine without the files.
 */
const DIR = "D:/DSC_Crm_Softw/Dsc_app/DscDocs/";
const MAIN = DIR + "BoQ LP Surat_MOtaVarachha.xlsx";
const SERVICES = DIR + "BoQ Services  LP Surat_MotaVarachha.xlsx";
const have = fs.existsSync(MAIN) && fs.existsSync(SERVICES);

beforeEach(() => logout());

const upload = (path: string, extra: Record<string, string> = {}) => {
  const f = fd(extra);
  f.set("file", new File([new Uint8Array(fs.readFileSync(path))], "boq.xlsx"));
  return f;
};
type Sheet = { name: string; count: number; hidden: boolean; measurement: boolean };

describe.skipIf(!have)("a BOQ with no rates and the client's own codes (Louis Philippe, Surat)", () => {
  let boqId = "";
  let quotationId = "";

  it("finds every sheet, including the ones headed with the scope name, and leaves the summary and the hidden sheet unticked", async () => {
    await loginAs("owner@dsc.demo");
    const main = ((await previewClientBoq(upload(MAIN))) as unknown as { data: { sheets: Sheet[] } }).data.sheets;
    expect(main.map((s) => s.name.trim())).toEqual(["Common BOQ", "LP Unique", "HI Street Electrical Work", "Mall Electrical Work"]); // the summary sheet is not a list of items
    expect(main.find((s) => s.name.startsWith("Mall"))!.hidden).toBe(true);
    expect(main.filter((s) => !s.hidden).every((s) => s.count > 0)).toBe(true);
    const svc = ((await previewClientBoq(upload(SERVICES))) as unknown as { data: { sheets: Sheet[] } }).data.sheets;
    expect(svc.map((s) => s.name.trim())).toEqual(["CCTV WORKS", "FAS WORKS", "MUSIC SYSTEM WORKS", "SPRINKLER WORKS", "FIRE SAFETY"]);
    expect(svc.map((s) => s.count)).toEqual([9, 10, 4, 8, 13]);
  });

  it("imports both files into one BOQ and keeps the client's codes, serial numbers and scope", async () => {
    await loginAs("owner@dsc.demo");
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    await db.client.update({ where: { id: client.id }, data: { companyName: "ADITYA BIRLA FASHION & RETAIL LIMITED", gstin: "29AAECP2371C1ZL" } });
    boqId = ((await createBoq(fd({ title: "LOUIS PHILIPPE – MOTA VARACHHA, SURAT", clientId: client.id }))) as { data: { id: string } }).data.id;
    const ticked = async (path: string) => ((await previewClientBoq(upload(path))) as unknown as { data: { sheets: Sheet[] } }).data.sheets.filter((s) => !s.hidden && !s.measurement).map((s) => s.name).join("|");
    expect((await importClientBoq(boqId, upload(MAIN, { sheets: await ticked(MAIN) }))).ok).toBe(true);
    expect((await importClientBoq(boqId, upload(SERVICES, { sheets: await ticked(SERVICES), mode: "append" }))).ok).toBe(true);

    const items = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    expect(items).toHaveLength(106 + 27 + 12 + 9 + 10 + 4 + 8 + 13);
    expect([...new Set(items.map((i) => i.package))]).toEqual(["Common BOQ", "LP Unique", "HI Street Electrical Work", "CCTV WORKS", "FAS WORKS", "MUSIC SYSTEM WORKS", "SPRINKLER WORKS", "FIRE SAFETY"]);
    const first = items.find((i) => i.ref === "A1" && i.package === "Common BOQ")!;
    expect(first).toMatchObject({ code: "CI_DISMANTLING04", hsn: "995419", subcategory: "Demolishing Works", category: "CIVIL", unit: "sqft" });
    expect(items.find((i) => i.code === "OP_CCTV002")).toMatchObject({ package: "CCTV WORKS", hsn: "85258010", unit: "nos", quantity: expect.anything() });
    expect(items.filter((i) => Number(i.sellingRate) > 0)).toHaveLength(0); // the client gave no rates
  });

  it("pricing and saving the BOQ on screen does not lose the codes, serial numbers or scope", async () => {
    await loginAs("director@dsc.demo"); // Management prices; the editor sends back every field it was given
    const items = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    const payload = items.map((i) => ({
      id: i.id, category: i.category, subcategory: i.subcategory ?? undefined, package: i.package ?? undefined, ref: i.ref ?? undefined, remarks: i.remarks ?? undefined, code: i.code ?? undefined, hsn: i.hsn ?? undefined,
      item: i.item, specification: i.specification ?? "", unit: i.unit, quantity: Number(i.quantity), materialCost: 0, labourCost: 0, otherCost: 0, sellingRate: 100,
    }));
    expect((await saveBoqItems(boqId, JSON.stringify(payload), 0)).ok).toBe(true);
    const after = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    expect(after).toHaveLength(items.length);
    for (let k = 0; k < items.length; k++) expect([after[k].package, after[k].ref, after[k].code, after[k].hsn, after[k].subcategory]).toEqual([items[k].package, items[k].ref, items[k].code, items[k].hsn, items[k].subcategory]);
    await loginAs("owner@dsc.demo");
    expect((await createQuotationFromBoq(boqId, fd({ clientId: (await db.boq.findUniqueOrThrow({ where: { id: boqId } })).clientId! }))).ok).toBe(true);
    quotationId = (await db.quotation.findFirstOrThrow({ where: { boqId } })).id;
    const qi = await db.quotationItem.findMany({ where: { quotationId } });
    expect(qi.filter((i) => i.code).length).toBe(after.filter((i) => i.code).length);
  });

  it("the quotation Excel has one sheet per scope, with Material code and HSN / SAC columns", async () => {
    await loginAs("owner@dsc.demo");
    const res = await quotationExcel(new NextRequest("http://x"), { params: Promise.resolve({ id: quotationId }) });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["SUMMARY LIST", "Common BOQ", "LP Unique", "HI Street Electrical Work", "CCTV WORKS", "FAS WORKS", "MUSIC SYSTEM WORKS", "SPRINKLER WORKS", "FIRE SAFETY"]);
    const cctv = wb.getWorksheet("CCTV WORKS")!;
    const head = cctv.getRow(9).values as unknown[];
    expect(head.slice(1, 5)).toEqual(["Sl. No.", "Material code", "HSN / SAC", "Work title"]);
    const rowA1 = [...Array(30).keys()].map((k) => cctv.getRow(k + 1)).find((r) => r.getCell(1).value === "A1")!;
    expect(rowA1.getCell(2).value).toBe("OP_CCTV002");
    expect(String(rowA1.getCell(3).value)).toBe("85258010");
    const cover = wb.getWorksheet("SUMMARY LIST")!;
    const names: string[] = [];
    cover.eachRow((row) => { if (typeof row.getCell(1).value === "number" && typeof row.getCell(2).value === "string") names.push(row.getCell(2).value as string); });
    expect(names).toEqual(["COMMON BOQ", "LP UNIQUE", "HI STREET ELECTRICAL WORK", "CCTV WORKS", "FAS WORKS", "MUSIC SYSTEM WORKS", "SPRINKLER WORKS", "FIRE SAFETY"]);
    // 189 items at Rs 100 each, with the quantities the client gave
    const q = await db.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { items: true } });
    expect(q.items).toHaveLength(189);
    expect(Number(q.subtotal)).toBeCloseTo(q.items.reduce((s, i) => s + Number(i.quantity) * 100, 0), 0);
  });
});
