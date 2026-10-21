import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createBoq, importClientBoq, previewClientBoq } from "@/app/(app)/sales/boq/actions";
import { createQuotationFromBoq } from "@/app/(app)/sales/quotations/actions";
import { GET as quotationExcel } from "@/app/(app)/sales/quotations/[id]/export/route";

/**
 * The real Frido Hyderabad workbook DSC sent back as its quotation. Skipped on a machine that does not have the file.
 * DSC's own cover says: civil 1,387,958.68 + FAS 50,750 + speaker 15,100 + electrical 458,725 + sprinkler 93,500 + fixtures 1,384,944.687.
 */
const FILE = "D:/DSC_Crm_Softw/Dsc_app/DscDocs/FRIDO @ Sarath City Of HYDERABAD  MASTER BOQ DSC Bill Draft 17102026.xlsx";
const have = fs.existsSync(FILE);

beforeEach(() => logout());

describe.skipIf(!have)("the real Frido quotation: client Excel in, DSC quotation Excel out", () => {
  let quotationId = "";
  let wb: ExcelJS.Workbook;

  it("reads every scope, leaves the measurement sheet out, and keeps each scope and serial number", async () => {
    await loginAs("owner@dsc.demo");
    const upload = () => {
      const f = fd({});
      f.set("file", new File([new Uint8Array(fs.readFileSync(FILE))], "frido.xlsx"));
      return f;
    };
    const pre = await previewClientBoq(upload());
    const sheets = (pre as unknown as { data: { sheets: { name: string; measurement: boolean; count: number }[] } }).data.sheets;
    expect(sheets.filter((s) => s.measurement).map((s) => s.name.trim())).toEqual(["M - Sheet"]);
    const picked = sheets.filter((s) => !s.measurement).map((s) => s.name);

    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    await db.client.update({ where: { id: client.id }, data: { companyName: "Arcatron Mobility Pvt Ltd", address: "Property No.722, Gat No 102, Vadgaon, Pune-412106", email: "accounts@myfrido.com", gstin: "27AANCA5219P1Z3" } });
    const b = await createBoq(fd({ title: "FRIDO, SARATH CITY OF HYDERABAD", clientId: client.id }));
    const boqId = (b as { data: { id: string } }).data.id;
    const f = upload();
    f.set("sheets", picked.join("|"));
    f.set("keepRates", "on");
    expect((await importClientBoq(boqId, f)).ok).toBe(true);

    const items = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    const packages = [...new Set(items.map((i) => i.package))];
    expect(packages).toEqual(["Civil and Interiors Works", "ELECTRICAL", "FAS", "SPEAKER", "SPRINKLER WORK", "Fixture"]);
    expect(items.some((i) => i.package?.includes("M - Sheet"))).toBe(false);
    expect(items.find((i) => i.ref === "B-1")?.subcategory).toBe("Flooring Works");
    expect(items.find((i) => i.ref === "DE 01")?.package).toBe("Fixture");
    expect(items.some((i) => /final total|grand total|gst @/i.test(i.item))).toBe(false); // their total rows are not items

    const q = await createQuotationFromBoq(boqId, fd({ clientId: client.id }));
    expect(q.ok).toBe(true);
    quotationId = (await db.quotation.findFirstOrThrow({ where: { boqId } })).id;
    await db.quotation.update({ where: { id: quotationId }, data: { clientPoNo: "PO-4521", clientPoDate: new Date("2026-08-20"), vendorCode: "V-DSC-77", paymentTerms: "50% advance payment\n20% after completion of the false ceiling\n30% after commissioning & handover." } });
  });

  it("exports in the client's shape: cover page plus one sheet per scope, in their order", async () => {
    await loginAs("owner@dsc.demo");
    const res = await quotationExcel(new NextRequest("http://x"), { params: Promise.resolve({ id: quotationId }) });
    expect(res.status).toBe(200);
    wb = new ExcelJS.Workbook();
    const bytes = Buffer.from(await res.arrayBuffer());
    if (process.env.SAVE_EXPORT) fs.writeFileSync(process.env.SAVE_EXPORT, bytes);
    await wb.xlsx.load(bytes as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["SUMMARY LIST", "Civil and Interiors Works", "ELECTRICAL", "FAS", "SPEAKER", "SPRINKLER WORK", "Fixture"]);
  });

  it("the cover shows the client, our references, one line per scope, GST and the terms", async () => {
    const cover = wb.getWorksheet("SUMMARY LIST")!;
    const texts: string[] = [];
    cover.eachRow((row) => row.eachCell((c) => { if (c.value !== null && typeof c.value !== "object") texts.push(String(c.value)); }));
    for (const t of ["QUOTATION", "To,", "Arcatron Mobility Pvt Ltd", "GSTIN/UIN : 27AANCA5219P1Z3", "PO-4521", "V-DSC-77", "SUMMARY", "CIVIL AND INTERIORS WORKS", "FIXTURE", "TOTAL", "GRAND TOTAL WITH TAXES"]) expect(texts.some((x) => x.includes(t))).toBe(true);
    expect(texts.some((x) => x.startsWith("SUB : FRIDO, SARATH CITY OF HYDERABAD"))).toBe(true);
    expect(texts.some((x) => x.includes("50% advance payment") && x.includes("30% after commissioning"))).toBe(true);
    // 18% GST on a Maharashtra company billing a Maharashtra client is split in two; the grand total follows the total
    const val = (label: string) => { let v = NaN; cover.eachRow((row) => { if (String(row.getCell(2).value).startsWith(label)) v = Number((row.getCell(7).value as { result?: number })?.result ?? row.getCell(7).value); }); return v; };
    const total = val("TOTAL");
    expect(total).toBeGreaterThan(3_000_000);
    expect(val("GRAND TOTAL WITH TAXES")).toBeCloseTo(total * 1.18, 0);
  });

  it("each scope's total matches DSC's own sheet, except the lines where DSC's file disagrees with itself", async () => {
    const totalOf = (name: string) => {
      const ws = wb.getWorksheet(name)!;
      let v = NaN;
      ws.eachRow((row) => { if (String(row.getCell(6).value).trim() === "TOTAL") v = Number((row.getCell(7).value as { result: number }).result); });
      return v;
    };
    expect(totalOf("Civil and Interiors Works")).toBeCloseTo(1387958.68, 0); // to the rupee: they do not round each line to the paisa
    expect(totalOf("FAS")).toBe(50750);
    expect(totalOf("SPEAKER")).toBe(15100);
    expect(totalOf("SPRINKLER WORK")).toBe(93500);
    // DSC's electrical total leaves out the camera cable (283 x 110 = 31,130): it has a quantity and a rate but no amount
    expect(totalOf("ELECTRICAL")).toBe(458725 + 31130);
    // DSC's fixtures total uses 50,000 for transport although the rate on that line says 40,000
    expect(totalOf("Fixture")).toBeCloseTo(1384944.687 - 10000, 0);
  });

  it("a scope sheet keeps the client's serial numbers, section headings and a subtotal per section", async () => {
    const civil = wb.getWorksheet("Civil and Interiors Works")!;
    const col = (n: number) => { const out: string[] = []; civil.eachRow((r) => { const v = r.getCell(n).value; if (v !== null && typeof v !== "object") out.push(String(v)); }); return out; };
    expect(col(1)).toEqual(expect.arrayContaining(["B-1", "B-8", "C1", "J-2"]));
    expect(col(1)).toContain("Flooring Works");
    expect(col(6)).toContain("SUBTOTAL");
    let formulas = 0;
    civil.eachRow((r) => { const v = r.getCell(7).value; if (v && typeof v === "object" && "formula" in v && String(v.formula).startsWith("ROUND(E")) formulas++; });
    expect(formulas).toBe(27);
  });
});
