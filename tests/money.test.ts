import { describe, it, expect } from "vitest";
import { computeTotals, boqItemTotals, boqSummary, amountInWords } from "@/lib/money";

describe("computeTotals", () => {
  it("computes subtotal, GST and total", () => {
    const t = computeTotals([
      { quantity: 10, rate: 1000, taxPercent: 18 },
      { quantity: 2, rate: 2500, taxPercent: 18 },
    ]);
    expect(t.subtotal).toBe(15000);
    expect(t.tax).toBe(2700);
    expect(t.total).toBe(17700);
  });

  it("applies percentage discount before tax, proportionally", () => {
    const t = computeTotals([{ quantity: 1, rate: 100000, taxPercent: 18 }], { pct: 10 });
    expect(t.discount).toBe(10000);
    expect(t.taxable).toBe(90000);
    expect(t.tax).toBe(16200);
    expect(t.total).toBe(106200);
  });

  it("handles mixed tax rates correctly with a discount", () => {
    const t = computeTotals(
      [
        { quantity: 1, rate: 50000, taxPercent: 18 },
        { quantity: 1, rate: 50000, taxPercent: 5 },
      ],
      { pct: 10 },
    );
    // each line discounted by 10%: 45000@18% = 8100, 45000@5% = 2250
    expect(t.tax).toBe(10350);
    expect(t.total).toBe(100000 - 10000 + 10350);
  });

  it("caps a fixed discount at the subtotal and never goes negative", () => {
    const t = computeTotals([{ quantity: 1, rate: 1000, taxPercent: 18 }], { amount: 5000 });
    expect(t.discount).toBe(1000);
    expect(t.total).toBe(0);
  });

  it("rounds to paise without float drift", () => {
    const t = computeTotals([{ quantity: 3, rate: 33.33, taxPercent: 18 }]);
    expect(t.subtotal).toBe(99.99);
    expect(t.tax).toBe(18);
    expect(t.total).toBe(117.99);
  });

  it("returns zeros for no items", () => {
    expect(computeTotals([]).total).toBe(0);
  });
});

describe("BOQ maths", () => {
  it("per-unit costs multiply by quantity; margin is revenue - cost", () => {
    const a = boqItemTotals({ quantity: 100, materialCost: 400, labourCost: 150, otherCost: 50, sellingRate: 800 });
    expect(a.estimatedCost).toBe(60000);
    expect(a.total).toBe(80000);
    const s = boqSummary([a, boqItemTotals({ quantity: 10, materialCost: 1000, labourCost: 0, otherCost: 0, sellingRate: 1300 })]);
    expect(s.cost).toBe(70000);
    expect(s.revenue).toBe(93000);
    expect(s.margin).toBe(23000);
    expect(s.marginPct).toBeCloseTo(24.73, 2);
  });

  it("margin % is 0 when there is no revenue", () => {
    expect(boqSummary([]).marginPct).toBe(0);
  });
});

describe("amountInWords", () => {
  it("formats Indian numbering", () => {
    expect(amountInWords(120000)).toBe("Rupees One Lakh Twenty Thousand Only");
    expect(amountInWords(25000000)).toBe("Rupees Two Crore Fifty Lakh Only");
    expect(amountInWords(1234.5)).toBe("Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
});
