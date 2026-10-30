import { describe, it, expect, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { parseBillText } from "@/lib/bill-text";
import { cleanBill } from "@/lib/bill-reader";

const now = new Date("2026-11-20");
const read = (text: string, conf = 0.95) => cleanBill(parseBillText(text, conf), now);

describe("picking the boxes out of the text of a bill", () => {
  it("a printed hardware receipt", () => {
    const r = read("SHARMA HARDWARE\nMumbai   Ph 98200 00000\nDate: 09 Nov 2026\nBill no: 4471\nFevicol SH 1 kg x2 700.00\nScrews 1.5 in, box 350.00\nSandpaper sheets x30 450.00\nDrill bits set 350.00\nTOTAL Rs 1,850.00\nThank you. Visit again");
    expect(r).toMatchObject({ isBill: true, readable: true, vendorName: "SHARMA HARDWARE", billNumber: "4471", billDate: "2026-11-09", totalAmount: 1850, category: "MATERIAL" });
    expect(r.description).toMatch(/SHARMA HARDWARE: Fevicol/);
    expect(r.unsure).not.toContain("totalAmount");
  });

  it("a GST tax invoice: takes the grand total, not the taxable value or the tax", () => {
    const r = read("Shree Ply and Laminates\nShop 7, Timber Market, Kalamboli, Navi Mumbai 410218\nGSTIN: 27ABCPS2101A1ZF PAN: ABCPS2101A\nTAX INVOICE\nInvoice No: SPL/26-27/1184\nDate: 16 Nov 2026\nDue date: 16 Dec 2026\nBilled to DSC Interior Pvt. Ltd.\nBWP Plywood 19 mm 8x4 ft 4412 nos 50 2,350.00 1,17,500.00\nTaxable value ₹ 2,07,360.00\nCGST @ 9% ₹ 18,662.40\nSGST @ 9% ₹ 18,662.40\nTotal amount ₹ 2,44,684.80\nAmount in words: Rupees Two Lakh Forty Four Thousand Six Hundred Eighty Four and Eighty Paise Only");
    expect(r).toMatchObject({ vendorName: "Shree Ply and Laminates", vendorGstin: "27ABCPS2101A1ZF", billNumber: "SPL/26-27/1184", billDate: "2026-11-16", dueDate: "2026-12-16", totalAmount: 244684.8 });
  });

  it("a rough handwritten bill with a day/month/year date and low confidence is flagged for checking", () => {
    const r = read("Ram Tempo Service\n5/11/26\nTempo hire 4 hrs 2800\nLoading 400\nTotal 3200", 0.62);
    expect(r).toMatchObject({ billDate: "2026-11-05", totalAmount: 3200, category: "TRAVEL", handwritten: true });
    expect(r.unsure).toEqual(expect.arrayContaining(["totalAmount", "billDate"]));
    expect(r.note).toMatch(/low confidence/);
  });

  it("a delivery challan has no total: the amount is left for a person, and the number is found", () => {
    const r = read("SHREE PLY AND LAMINATES\nDELIVERY CHALLAN\nNo. SPL/CH/2210\nDate 12-11-2026\nTo: DSC Interior Pvt. Ltd.\nBWP Plywood 19 mm 8x4 ft nos 30\nLaminate 1 mm nos 45");
    expect(r).toMatchObject({ billNumber: "SPL/CH/2210", billDate: "2026-11-12", totalAmount: null, isBill: true });
    expect(r.note).toMatch(/No total/);
  });

  it("says so when the picture is not a bill or cannot be read", () => {
    expect(read("hello").readable).toBe(false);
    expect(read("A photo of a cat on a sofa near the window, very sunny day today").isBill).toBe(false);
    expect(read("TOTAL Rs 500\nBill no 12 date 01/11/2026", 0.2).readable).toBe(false);
  });

  it("never turns a mobile number or a date into the total", () => {
    const r = read("SOME SHOP\nPh 98200 12345\nDate 03/11/2026\nGST 18% included\nTotal 740");
    expect(r.totalAmount).toBe(740);
  });
});

describe("the Google reader", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const calls: { url: string; body?: string; auth?: string }[] = [];
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_VISION_CREDENTIALS; calls.length = 0; });

  async function withFetch(reply: (url: string) => Response) {
    process.env.GOOGLE_VISION_CREDENTIALS = JSON.stringify({ client_email: "reader@dsc-sample.iam.gserviceaccount.com", private_key: privateKey, project_id: "dsc-sample" });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, body: init?.body as string, auth: (init?.headers as Record<string, string>)?.authorization }); return reply(url); }));
    return await import("@/lib/bill-google");
  }
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });

  it("signs in once, sends a photo, and returns the text with an average confidence", async () => {
    const g = await withFetch((u) => u.includes("oauth2") ? ok({ access_token: "tok-1", expires_in: 3600 }) : ok({ responses: [{ fullTextAnnotation: { text: "SHARMA HARDWARE\nTOTAL Rs 1,850.00", pages: [{ blocks: [{ paragraphs: [{ words: [{ confidence: 0.9 }, { confidence: 0.7 }] }] }] }] } }] }));
    expect(g.googleReadingOn()).toBe(true);
    const r = await g.readTextGoogle(Buffer.from("x"), "image/jpeg");
    expect(r.text).toContain("TOTAL Rs 1,850.00");
    expect(r.confidence).toBeCloseTo(0.8, 5);
    expect(calls.map((c) => c.url)).toEqual(expect.arrayContaining(["https://oauth2.googleapis.com/token", "https://vision.googleapis.com/v1/images:annotate"]));
    const vision = calls.find((c) => c.url.includes("vision"))!;
    expect(vision.auth).toBe("Bearer tok-1");
    expect(JSON.parse(vision.body!).requests[0].features[0].type).toBe("DOCUMENT_TEXT_DETECTION");
  });

  it("reads a PDF through the file endpoint, page by page", async () => {
    const g = await withFetch((u) => u.includes("oauth2") ? ok({ access_token: "tok-2", expires_in: 3600 }) : ok({ responses: [{ responses: [{ fullTextAnnotation: { text: "Page one" } }, { fullTextAnnotation: { text: "Page two" } }] }] }));
    const r = await g.readTextGoogle(Buffer.from("%PDF"), "application/pdf");
    expect(r.text).toBe("Page one\nPage two");
    expect(calls.some((c) => c.url.endsWith("/files:annotate"))).toBe(true);
  });

  it("gives friendly messages when Google refuses, is busy, or the file cannot be read", async () => {
    for (const [status, re] of [[403, /not set up correctly/], [429, /busy/], [400, /could not be read/]] as const) {
      const g = await withFetch((u) => (u.includes("oauth2") ? ok({ access_token: "t", expires_in: 3600 }) : new Response("{}", { status })));
      await expect(g.readTextGoogle(Buffer.from("x"), "image/png")).rejects.toThrow(re);
    }
  });
});
