import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { findRate, rateKey, sellFromCost } from "@/lib/rate-card";
import { createBoq, saveBoqItems } from "@/app/(app)/sales/boq/actions";
import { saveRateCard, saveRatesForClient, setBoqClient, skipLastRates, applyLastRates } from "@/app/(app)/sales/boq/rate-actions";

beforeEach(() => logout());

const item = (over: Record<string, unknown>) => ({ category: "FLOORING", item: "Vitrified tile 600x600", specification: "", unit: "sqft", quantity: 100, materialCost: 0, labourCost: 0, otherCost: 0, sellingRate: 0, ...over });

describe("rate card helpers", () => {
  it("matches names loosely and prefers the same unit", () => {
    expect(rateKey(" Vitrified Tile 600X600 ")).toBe(rateKey("vitrified tile 600x600"));
    const rates = [{ nameKey: "tile", unit: "sqft" }, { nameKey: "tile", unit: "rft" }, { nameKey: "paint", unit: "sqft" }];
    expect(findRate(rates, "Tile", "rft")).toEqual(rates[1]);
    expect(findRate(rates, "Tile", "nos")).toBeUndefined(); // two units, none matches: do not guess
    expect(findRate(rates, "PAINT", "nos")).toEqual(rates[2]); // only one unit known: use it
    expect(findRate(rates, "", "sqft")).toBeUndefined();
  });
  it("adds profit on cost to the paisa", () => {
    expect(sellFromCost(100, 25)).toBe(125);
    expect(sellFromCost(133.33, 18.5)).toBe(158)
    expect(sellFromCost(0, 30)).toBe(0);
  });
});

describe("a client's rate card on a BOQ", () => {
  let clientA = "";
  let clientB = "";
  let first = "";
  let second = "";

  it("is remembered from the first BOQ and offered on the next", async () => {
    await loginAs("director@dsc.demo");
    const [a, b] = await db.client.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, take: 2 });
    clientA = a.id;
    clientB = b.id;
    await db.clientRateCard.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });

    const created = await createBoq(fd({ title: "Rate card test 1", clientId: clientA }));
    first = (created as { data: { id: string } }).data.id;
    expect((await db.boq.findUniqueOrThrow({ where: { id: first } })).clientId).toBe(clientA);
    const items = [item({}), item({ item: "Skirting", unit: "rft", quantity: 50, materialCost: 40, labourCost: 10, otherCost: 0 }), item({ item: "Brand new item", quantity: 2 })];
    items[0] = { ...items[0], materialCost: 100, labourCost: 20, otherCost: 5, sellingRate: 156.25 };
    expect((await saveBoqItems(first, JSON.stringify(items), 25)).ok).toBe(true);
    expect(Number((await db.boq.findUniqueOrThrow({ where: { id: first } })).profitPct)).toBe(25);

    expect((await saveRatesForClient(first, 25)).ok).toBe(true);
    const card = await db.clientRateCard.findUniqueOrThrow({ where: { clientId: clientA }, include: { rates: true } });
    expect(Number(card.profitPct)).toBe(25);
    expect(card.rates.map((r) => r.name).sort()).toEqual(["Skirting", "Vitrified tile 600x600"]); // the row with no cost is not remembered

    // a second BOQ for the same client starts with the saved profit and is asked about the rates
    second = ((await createBoq(fd({ title: "Rate card test 2", clientId: clientA }))) as { data: { id: string } }).data.id;
    const b2 = await db.boq.findUniqueOrThrow({ where: { id: second } });
    expect(Number(b2.profitPct)).toBe(25);
    expect(b2.ratesAppliedAt).toBeNull();
    const rows = [item({ item: "VITRIFIED  tile 600X600", quantity: 200 }), item({ item: "Skirting", unit: "rft", quantity: 80 }), item({ item: "Something else", quantity: 3 })];
    expect((await saveBoqItems(second, JSON.stringify(rows))).ok).toBe(true);

    const r = await applyLastRates(second);
    expect(r.ok).toBe(true);
    expect((r as unknown as { data: object }).data).toMatchObject({ exact: 2, worded: 0, left: 1 });
    const filled = await db.boqItem.findMany({ where: { boqId: second }, orderBy: { sortOrder: "asc" } });
    expect(filled.map((i) => [Number(i.materialCost), Number(i.labourCost), Number(i.otherCost), Number(i.sellingRate)])).toEqual([
      [100, 20, 5, 156.25],
      [40, 10, 0, 62.5],
      [0, 0, 0, 0],
    ]);
    expect(Number(filled[0].total)).toBe(31250); // 200 x 156.25
    expect(Number(filled[0].estimatedCost)).toBe(25000);
    expect((await db.boq.findUniqueOrThrow({ where: { id: second } })).ratesAppliedAt).not.toBeNull();
  });

  it("can be changed per BOQ without touching the saved card, and on its own screen", async () => {
    await loginAs("director@dsc.demo");
    const before = await db.clientRateCard.findUniqueOrThrow({ where: { clientId: clientA }, include: { rates: true } });
    const rows = [item({ item: "Vitrified tile 600x600", materialCost: 130, labourCost: 20, sellingRate: 195 })];
    expect((await saveBoqItems(second, JSON.stringify(rows), 30)).ok).toBe(true);
    const after = await db.clientRateCard.findUniqueOrThrow({ where: { clientId: clientA } });
    expect(Number(after.profitPct)).toBe(25); // unchanged until "remember" is pressed
    expect(before.rates).toHaveLength(2);

    expect((await saveRateCard(clientA, 30, JSON.stringify([{ name: "Vitrified tile 600x600", unit: "sqft", category: "FLOORING", materialRate: 130, labourRate: 20, otherRate: 0 }, { name: "vitrified TILE 600x600", unit: "sqft" }]))).ok).toBe(true);
    const card = await db.clientRateCard.findUniqueOrThrow({ where: { clientId: clientA }, include: { rates: true } });
    expect(Number(card.profitPct)).toBe(30);
    expect(card.rates).toHaveLength(1); // the duplicate name is dropped
    expect(Number(card.rates[0].materialRate)).toBe(130);
    expect((await saveRateCard(clientA, -5, "[]")).ok).toBe(false);
    expect((await saveRateCard(clientA, 20, "not json")).ok).toBe(false);
  });

  it("can be skipped (start fresh), and each client keeps its own", async () => {
    await loginAs("director@dsc.demo");
    const third = ((await createBoq(fd({ title: "Rate card test 3" }))) as { data: { id: string } }).data.id;
    expect((await applyLastRates(third)).ok).toBe(false); // no client yet
    expect((await setBoqClient(third, fd({ clientId: clientB }))).ok).toBe(true);
    expect((await applyLastRates(third)).ok).toBe(true); // client B has no saved rates of its own, but other clients' rates can be used
    expect((await skipLastRates(third)).ok).toBe(true);
    expect((await db.boq.findUniqueOrThrow({ where: { id: third } })).ratesAppliedAt).not.toBeNull();
    // changing the client asks again
    expect((await setBoqClient(third, fd({ clientId: clientA }))).ok).toBe(true);
    const b = await db.boq.findUniqueOrThrow({ where: { id: third } });
    expect(b.ratesAppliedAt).toBeNull();
    expect(Number(b.profitPct)).toBe(30);
    expect((await db.clientRateCard.findUnique({ where: { clientId: clientB } }))).toBeNull();
  });

  it("is closed to people who may not see costs, and to approved BOQs", async () => {
    for (const email of ["sales@dsc.demo", "designer@dsc.demo", "supervisor@dsc.demo"]) {
      await loginAs(email);
      expect((await applyLastRates(second)).ok).toBe(false);
      expect((await saveRatesForClient(second, 20)).ok).toBe(false);
      expect((await saveRateCard(clientA, 20, "[]")).ok).toBe(false);
    }
    logout();
    expect((await saveRateCard(clientA, 20, "[]")).ok).toBe(false);
    // a designer saving the BOQ cannot change its profit %
    await loginAs("designer@dsc.demo");
    await saveBoqItems(second, JSON.stringify([item({})]), 99);
    expect(Number((await db.boq.findUniqueOrThrow({ where: { id: second } })).profitPct)).toBe(30);
    await db.boq.update({ where: { id: second }, data: { status: "APPROVED" } });
    await loginAs("director@dsc.demo");
    expect((await applyLastRates(second)).ok).toBe(false);
    expect((await setBoqClient(second, fd({ clientId: clientB }))).ok).toBe(false);
  });
});
