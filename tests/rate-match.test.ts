import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { closeRate, nameScore, wordKey } from "@/lib/rate-card";
import { createBoq, previewClientBoq, saveBoqItems } from "@/app/(app)/sales/boq/actions";
import { applyLastRates, saveRatesForClient } from "@/app/(app)/sales/boq/rate-actions";

beforeEach(() => logout());

describe("the same item, worded differently", () => {
  it("ignores how-it-is-done words, plurals and number words; sizes must agree", () => {
    expect(wordKey("Providing and fixing 18 mm BWP ply")).toEqual(["18mm", "bwp", "ply"]);
    expect(nameScore("Providing and fixing 18 mm BWP ply", "Supply & installation of 18mm BWP plywood")).toBe(1);
    expect(nameScore("Painting two coats emulsion", "Providing and applying 2 coats of emulsion paint")).toBe(1);
    expect(nameScore("P&F 12mm gypsum false ceiling", "Providing and fixing 12 mm gypsum board false ceiling")).toBeGreaterThanOrEqual(0.75);
    expect(nameScore("Providing and fixing 18 mm BWP ply", "Providing and fixing 12 mm BWP ply")).toBe(0); // a different size is a different item
    expect(nameScore("Bottle trap", "Trap door")).toBeLessThan(0.75);
  });

  it("matches only in the same unit", () => {
    const rates = [{ name: "Supply and fixing of vitrified tiles 600x600", unit: "sqft" }];
    expect(closeRate(rates, "Providing and laying vitrified tile 600x600", "sqft")?.rate).toBe(rates[0]);
    expect(closeRate(rates, "Providing and laying vitrified tile 600x600", "nos")).toBeUndefined();
  });
});

const item = (o: Record<string, unknown>) => ({ category: "OTHER", item: "x", unit: "sqft", quantity: 10, materialCost: 0, labourCost: 0, otherCost: 0, sellingRate: 0, ...o });

describe("filling a BOQ from the rates DSC already has", () => {
  it("exact from this client, worded differently from this client, and from another client: the last two are marked to check", async () => {
    await loginAs("director@dsc.demo");
    const company = await db.company.findFirstOrThrow();
    const mk = (name: string) => { const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 9999)}`; return db.client.create({ data: { companyId: company.id, code: `CL-RM${tag}`, name: `${name} ${tag}` } }); };
    const [mine, other] = await Promise.all([mk("Match client"), mk("Other client")]);
    // other client: saved rates for laminate
    const ob = ((await createBoq(fd({ title: "Other", clientId: other.id }))) as { data: { id: string } }).data.id;
    await saveBoqItems(ob, JSON.stringify([item({ item: "Supply and fixing of 1 mm laminate", materialCost: 60, labourCost: 15 })]), 20);
    expect((await saveRatesForClient(ob, 20)).ok).toBe(true);
    // this client: saved rates for ply and painting
    const first = ((await createBoq(fd({ title: "Mine 1", clientId: mine.id }))) as { data: { id: string } }).data.id;
    await saveBoqItems(first, JSON.stringify([item({ item: "Providing and fixing 18 mm BWP ply", materialCost: 100, labourCost: 20 }), item({ item: "Emulsion paint 2 coats", materialCost: 20, labourCost: 10 })]), 25);
    expect((await saveRatesForClient(first, 25)).ok).toBe(true);

    const second = ((await createBoq(fd({ title: "Mine 2", clientId: mine.id }))) as { data: { id: string } }).data.id;
    await saveBoqItems(second, JSON.stringify([
      item({ item: "Emulsion paint 2 coats" }), // exact
      item({ item: "Supply & installation of 18mm BWP plywood" }), // worded differently
      item({ item: "Providing and fixing 1mm laminate" }), // only the other client has it
      item({ item: "Brand new item" }), // nobody has it
    ]));
    const r = await applyLastRates(second);
    expect(r.ok).toBe(true);
    expect((r as unknown as { data: object }).data).toEqual({ exact: 1, worded: 1, otherClient: 1, left: 1 });
    const rows = await db.boqItem.findMany({ where: { boqId: second }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((x) => Number(x.sellingRate))).toEqual([37.5, 150, 93.75, 0]); // cost + this client's 25 %
    expect(rows[0].rateNote).toBeNull();
    expect(rows[1].rateNote).toMatch(/worded differently/);
    expect(rows[2].rateNote).toMatch(/^Rate from Other client/);
    // the person looks and saves: the note goes when it is cleared in the editor (saved without it)
    await saveBoqItems(second, JSON.stringify(rows.map((x) => ({ id: x.id, category: x.category, item: x.item, unit: x.unit, quantity: Number(x.quantity), materialCost: Number(x.materialCost), labourCost: Number(x.labourCost), otherCost: Number(x.otherCost), sellingRate: Number(x.sellingRate), rateNote: x === rows[1] ? null : x.rateNote }))));
    const after = await db.boqItem.findMany({ where: { boqId: second }, orderBy: { sortOrder: "asc" } });
    expect(after.map((x) => !!x.rateNote)).toEqual([false, false, true, false]);
  });
});

describe("importing a client file with the same list twice", () => {
  it("says which sheet repeats which, and leaves the copy for the person to tick", async () => {
    await loginAs("director@dsc.demo");
    const wb = new ExcelJS.Workbook();
    const rows = [["Description", "Unit", "Qty"], ["Providing and fixing 18 mm ply", "sqft", 100], ["Vitrified tile 600x600", "sqft", 200], ["Emulsion paint", "sqft", 300]];
    wb.addWorksheet("Store BOQ").addRows(rows);
    wb.addWorksheet("Store BOQ (copy)").addRows(rows);
    wb.addWorksheet("Electrical").addRows([["Description", "Unit", "Qty"], ["Light point", "nos", 20], ["Power point", "nos", 10]]);
    const x = new FormData(); x.set("file", new File([new Uint8Array(Buffer.from(await wb.xlsx.writeBuffer()))], "client.xlsx"));
    const r = await previewClientBoq(x);
    expect(r.ok).toBe(true);
    const sheets = (r as unknown as { data: { sheets: { name: string; repeats: string | null }[] } }).data.sheets;
    expect(sheets.map((s) => [s.name, s.repeats])).toEqual([["Store BOQ", null], ["Store BOQ (copy)", "Store BOQ"], ["Electrical", null]]);
  });
});
