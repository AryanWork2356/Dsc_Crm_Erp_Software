import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs, logout, fd } from "./setup";
import { splitTax, stateFromGstin, taxTotalRows } from "@/lib/gst";
import { REPORTS } from "@/lib/reports";
import { createInvoice } from "@/app/(app)/finance/actions";
import { GET as invoicePdf } from "@/app/(app)/finance/invoices/[id]/pdf/route";
import { GET as quotationPdf } from "@/app/(app)/sales/quotations/[id]/pdf/route";
import { GET as poPdf } from "@/app/(app)/procurement/orders/[id]/pdf/route";

beforeEach(() => logout());

const DSC = "27AAECD2813K1ZP"; // Maharashtra
const KA = "29AABCI1111A1Z5"; // Karnataka
const MH = "27AABCM2222B1Z9";

describe("GST split maths", () => {
  it("reads the state from a GSTIN", () => {
    expect(stateFromGstin(DSC)).toBe("27");
    expect(stateFromGstin(KA)).toBe("29");
    expect(stateFromGstin("not a gstin")).toBeNull();
    expect(stateFromGstin("99AAECD2813K1ZP")).toBeNull(); // no such state code
    expect(stateFromGstin(null)).toBeNull();
  });

  const lines = [{ amount: 100000, taxPercent: 18 }];

  it("same state → CGST + SGST halves", () => {
    const s = splitTax(lines, { companyGstin: DSC, partyGstin: MH });
    expect(s.type).toBe("INTRA");
    expect(s.cgst).toBe(9000);
    expect(s.sgst).toBe(9000);
    expect(s.igst).toBe(0);
    expect(s.tax).toBe(18000);
    expect(taxTotalRows(s, (n) => String(n))).toEqual([["CGST @ 9%", "9000"], ["SGST @ 9%", "9000"]]);
  });

  it("another state → IGST", () => {
    const s = splitTax(lines, { companyGstin: DSC, partyGstin: KA });
    expect(s.type).toBe("INTER");
    expect(s).toMatchObject({ cgst: 0, sgst: 0, igst: 18000, tax: 18000 });
    expect(taxTotalRows(s, (n) => String(n))).toEqual([["IGST @ 18%", "18000"]]);
  });

  it("the place of supply chosen on the document wins over the GSTIN", () => {
    expect(splitTax(lines, { companyGstin: DSC, partyGstin: MH, placeOfSupply: "29" }).type).toBe("INTER");
    expect(splitTax(lines, { companyGstin: DSC, partyGstin: KA, placeOfSupply: "27" }).type).toBe("INTRA");
    expect(splitTax(lines, { companyGstin: DSC, partyGstin: KA, placeOfSupply: "00" }).type).toBe("INTER"); // junk is ignored → GSTIN used
  });

  it("with no GSTIN for the client or for us, it assumes the same state", () => {
    expect(splitTax(lines, { companyGstin: DSC, partyGstin: null }).type).toBe("INTRA");
    expect(splitTax(lines, { companyGstin: null, partyGstin: KA }).type).toBe("INTRA");
  });

  it("splits per rate, applies the discount to every rate, and adds up to the stored tax to the paisa", () => {
    const mixed = [{ amount: 100000, taxPercent: 18 }, { amount: 50000, taxPercent: 12 }, { amount: 20000, taxPercent: 0 }];
    const s = splitTax(mixed, { companyGstin: DSC, partyGstin: MH, discount: 17000 }); // 10% off 170000
    expect(s.rates.map((r) => r.rate)).toEqual([12, 18]); // 0% has no tax line
    expect(s.rates.find((r) => r.rate === 18)!.taxable).toBe(90000);
    expect(s.rates.find((r) => r.rate === 12)!.taxable).toBe(45000);
    expect(s.tax).toBe(16200 + 5400);
    // an odd stored tax is matched exactly
    const odd = splitTax([{ amount: 333.33, taxPercent: 18 }], { companyGstin: DSC, partyGstin: MH, storedTax: 60.01 });
    expect(odd.tax).toBe(60.01);
    expect(odd.cgst + odd.sgst).toBeCloseTo(60.01, 2);
  });
});

describe("GST on documents and the register", () => {
  it("saves the place of supply, and the sales register splits CGST/SGST vs IGST per invoice", async () => {
    const company = await db.company.findFirstOrThrow();
    await db.companySettings.update({ where: { companyId: company.id }, data: { gstin: DSC } });
    const local = await db.client.create({ data: { companyId: company.id, code: "CL-GST1", name: "Local Client", gstin: MH } });
    const far = await db.client.create({ data: { companyId: company.id, code: "CL-GST2", name: "Karnataka Client", gstin: KA } });
    const items = JSON.stringify([{ description: "Interior work", unit: "lumpsum", quantity: 1, rate: 100000, taxPercent: 18 }]);

    await loginAs("accounts@dsc.demo");
    const make = async (clientId: string, extra: Record<string, string> = {}) => {
      const r = await createInvoice(fd({ clientId, issueDate: "2032-04-10", items, ...extra }));
      expect(r.ok).toBe(true);
    };
    await make(local.id);
    await make(far.id);
    await make(local.id, { placeOfSupply: "29" }); // supplied to a site in Karnataka
    const invs = await db.invoice.findMany({ where: { clientId: { in: [local.id, far.id] } }, orderBy: { createdAt: "asc" } });
    expect(invs[2].placeOfSupply).toBe("29");
    expect(invs[0].placeOfSupply).toBeNull();
    // issue them so they appear in the register
    await db.invoice.updateMany({ where: { id: { in: invs.map((i) => i.id) } }, data: { status: "SENT" } });

    const report = REPORTS.find((r) => r.key === "gst-sales")!;
    await loginAs("accounts@dsc.demo");
    const c = (await getCtx())!;
    const out = await report.run(c, { from: new Date("2032-04-01T00:00:00Z"), to: new Date("2032-05-01T00:00:00Z") });
    expect(out.rows).toHaveLength(3);
    const [a, b, d] = out.rows;
    expect([a.cgst, a.sgst, a.igst]).toEqual([9000, 9000, 0]); // same state
    expect([b.cgst, b.sgst, b.igst]).toEqual([0, 0, 18000]); // Karnataka GSTIN
    expect([d.cgst, d.sgst, d.igst]).toEqual([0, 0, 18000]); // place of supply overridden
    expect(a.place).toBe("Maharashtra (27)");
    expect(b.place).toBe("Karnataka (29)");
    expect(out.totals).toMatchObject({ taxable: 300000, cgst: 9000, sgst: 9000, igst: 36000 });
  });

  it("invoice, quotation and purchase-order PDFs still open", async () => {
    await loginAs("owner@dsc.demo");
    const inv = await db.invoice.findFirstOrThrow({ where: { number: { not: "" } }, orderBy: { createdAt: "desc" } });
    const q = await db.quotation.findFirstOrThrow({ where: { items: { some: {} } } });
    const po = await db.purchaseOrder.findFirstOrThrow({ where: { items: { some: {} } } });
    for (const [res, label] of [
      [await invoicePdf(new NextRequest("http://x"), { params: Promise.resolve({ id: inv.id }) }), "invoice"],
      [await quotationPdf(new NextRequest("http://x"), { params: Promise.resolve({ id: q.id }) }), "quotation"],
      [await poPdf(new NextRequest("http://x"), { params: Promise.resolve({ id: po.id }) }), "purchase order"],
    ] as const) {
      expect(res.status, label).toBe(200);
      expect(res.headers.get("content-type"), label).toBe("application/pdf");
      expect((await res.arrayBuffer()).byteLength, label).toBeGreaterThan(1500);
    }
  });

  it("the register is for people who can see invoices and finance", async () => {
    const report = REPORTS.find((r) => r.key === "gst-sales")!;
    await loginAs("sales@dsc.demo");
    const c = (await getCtx())!;
    expect(c.can(report.perm) && (!report.extra || c.can(report.extra))).toBe(false);
    await loginAs("accounts@dsc.demo");
    const a = (await getCtx())!;
    expect(a.can(report.perm) && (!report.extra || a.can(report.extra))).toBe(true);
  });
});
