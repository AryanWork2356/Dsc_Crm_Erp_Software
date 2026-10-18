import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { basisFor, finalQty, lineProblem, lineValue, parseMeasurements, type MeasureLine } from "@/lib/measure";
import { createBoq, reviseBoq, saveBoqItems } from "@/app/(app)/sales/boq/actions";
import { createQuotationFromBoq } from "@/app/(app)/sales/quotations/actions";
import { PAYMENT_PRESETS } from "@/lib/payment-terms";

beforeEach(() => logout());

const L = (lenFt: number, lenIn: number, widFt: number, widIn: number, qty = 1, less = false, desc = ""): MeasureLine => ({ desc, lenFt, lenIn, widFt, widIn, qty, less });

describe("measurement maths – DSC Frido M-Sheet", () => {
  it("matches the PCC line: 76'2\" x 18'9\" less staircase 8'2\" x 5'3\" = 1385.25 sqft", () => {
    const lines = [L(76, 2, 18, 9), L(8, 2, 5, 3, 1, true)];
    expect(lineValue(lines[0], "sqft")).toBeCloseTo(1428.125, 3);
    expect(lineValue(lines[1], "sqft")).toBeCloseTo(-42.875, 3);
    expect(finalQty(lines, "sqft")).toBe(1385.25);
  });

  it("matches the vitrified-tile line with several deductions and an add-back = 917.715 sqft", () => {
    const lines = [
      L(63, 10, 18, 0), // main area 1149
      L(55, 3, 5, 0, 1, true), // granite strip
      L(8, 2, 5, 3, 1, true), // entry granite
      L(12, 6, 7, 2, 1, true), // carpet
      L(10, 2, 4, 10, 1, true), // dark grey tile
      L(18, 9, 12, 1), // BOH area added back
    ];
    expect(finalQty(lines, "sqft")).toBeCloseTo(917.715, 3);
  });

  it("uses length only for running feet, count only for pieces", () => {
    expect(basisFor("rft")).toBe("LENGTH");
    expect(basisFor("sqft")).toBe("AREA");
    expect(basisFor("nos")).toBe("COUNT");
    expect(finalQty([L(10, 6, 0, 0, 4)], "rft")).toBe(42); // 10.5 ft x 4
    expect(finalQty([L(0, 0, 0, 0, 7), L(0, 0, 0, 0, 2, true)], "nos")).toBe(5);
  });

  it("converts to square / running metres when the unit says so", () => {
    expect(finalQty([L(10, 0, 10, 0)], "sqm")).toBeCloseTo(9.29, 2); // 100 sqft
    expect(finalQty([L(10, 0, 0, 0)], "rmt")).toBeCloseTo(3.048, 3);
  });

  it("never goes below zero and ignores nonsense values", () => {
    expect(finalQty([L(5, 0, 5, 0, 1, true)], "sqft")).toBe(0);
    expect(finalQty([], "sqft")).toBe(0);
    expect(parseMeasurements({ lines: [{ lenFt: "12", lenIn: "x", widFt: 3, qty: 2 }] })[0]).toMatchObject({ lenFt: 12, lenIn: 0, widFt: 3, qty: 2, less: false });
    expect(parseMeasurements(null)).toEqual([]);
    expect(parseMeasurements({ lines: "bad" })).toEqual([]);
  });

  it("explains a bad line in plain words", () => {
    expect(lineProblem(L(10, 12, 5, 0), "sqft")).toMatch(/less than 12/);
    expect(lineProblem(L(0, 0, 5, 0), "sqft")).toMatch(/length/i);
    expect(lineProblem(L(10, 0, 0, 0), "sqft")).toMatch(/width/i);
    expect(lineProblem(L(10, 0, 5, 0, 0), "sqft")).toMatch(/Qty/);
    expect(lineProblem(L(10, 0, 5, 0), "sqft")).toBeNull();
    expect(lineProblem(L(0, 0, 0, 0, 3), "nos")).toBeNull();
  });
});

describe("BOQ with measurement sheets", () => {
  const item = (over: Record<string, unknown> = {}) => ({ category: "FLOORING", item: "Vitrified tile flooring", unit: "sqft", quantity: 999, sellingRate: 190, materialCost: 100, labourCost: 40, otherCost: 10, ...over });
  let boqId = "";

  it("the server calculates the quantity from the measurements and ignores a typed one", async () => {
    await loginAs("owner@dsc.demo");
    const created = await createBoq(fd({ title: "Measurement test BOQ" }));
    expect(created.ok).toBe(true);
    boqId = (created as { data: { id: string } }).data.id;
    const lines = [L(63, 10, 18, 0), L(8, 2, 5, 3, 1, true)];
    const r = await saveBoqItems(boqId, JSON.stringify([item({ measurements: { lines } }), item({ item: "Skirting", unit: "rft", quantity: 0, sellingRate: 95, measurements: { lines: [L(20, 6, 0, 0, 2)] } }), item({ item: "Plain row", unit: "nos", quantity: 3 })]));
    expect(r.ok).toBe(true);
    const rows = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    expect(Number(rows[0].quantity)).toBe(1106.125); // 1149 - 42.875, not the typed 999
    expect(Number(rows[0].total)).toBeCloseTo(1106.125 * 190, 1);
    expect(Number(rows[1].quantity)).toBe(41); // 20.5 x 2
    expect(Number(rows[2].quantity)).toBe(3); // no sheet → typed quantity stands
    expect(parseMeasurements(rows[0].measurements)).toHaveLength(2);
    expect(rows[2].measurements).toBeNull();
  });

  it("refuses a measurement line with 12 or more inches", async () => {
    await loginAs("owner@dsc.demo");
    const r = await saveBoqItems(boqId, JSON.stringify([item({ measurements: { lines: [L(10, 12, 5, 0)] } })]));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/less than 12/);
    expect(await db.boqItem.count({ where: { boqId } })).toBe(3); // nothing was overwritten
  });

  it("removing the sheet returns to a hand-typed quantity", async () => {
    await loginAs("owner@dsc.demo");
    const rows = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    const r = await saveBoqItems(boqId, JSON.stringify([item({ id: rows[0].id, quantity: 1200, measurements: null })]));
    expect(r.ok).toBe(true);
    const again = await db.boqItem.findMany({ where: { boqId } });
    expect(Number(again[0].quantity)).toBe(1200);
    expect(again[0].measurements).toBeNull();
  });

  it("a revision keeps the measurement sheets, and a quotation gets the company's payment terms", async () => {
    await loginAs("owner@dsc.demo");
    const lines = [L(40, 0, 10, 0), L(5, 0, 4, 0, 1, true)];
    expect((await saveBoqItems(boqId, JSON.stringify([item({ measurements: { lines } })]))).ok).toBe(true);
    const sub = await db.boq.findUniqueOrThrow({ where: { id: boqId } });
    expect(sub.status).toBe("DRAFT");

    // quotation from the BOQ
    const client = await db.client.findFirstOrThrow({});
    const q = await createQuotationFromBoq(boqId, fd({ clientId: client.id }));
    expect(q.ok).toBe(true);
    const quote = await db.quotation.findFirstOrThrow({ where: { boqId }, include: { items: true } });
    expect(Number(quote.items[0].quantity)).toBe(380); // 400 - 20
    expect(quote.paymentTerms).toMatch(/50% advance/);
    expect(quote.paymentTerms).toMatch(/40% before project handover/);

    // revision of an approved BOQ keeps the measurements
    await db.boq.update({ where: { id: boqId }, data: { status: "APPROVED" } });
    const rev = await reviseBoq(boqId);
    expect(rev.ok).toBe(true);
    const copy = await db.boq.findFirstOrThrow({ where: { number: { endsWith: "-R2" }, title: "Measurement test BOQ" }, include: { items: true } });
    expect(parseMeasurements(copy.items[0].measurements)).toHaveLength(2);
    expect(Number(copy.items[0].quantity)).toBe(380);
  });

  it("payment presets include the schedules DSC uses", () => {
    expect(PAYMENT_PRESETS.map((p) => p.label).join(" | ")).toMatch(/50 \/ 40 \/ 10/);
    expect(PAYMENT_PRESETS.map((p) => p.label).join(" | ")).toMatch(/50 \/ 50/);
  });
});
