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

  it("the rates typed on one BOQ are saved for the client, and filled on the next only when asked; new items stay empty", async () => {
    await loginAs("director@dsc.demo");
    const [a, b] = await db.client.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, take: 2 });
    clientA = a.id;
    clientB = b.id;
    await db.clientRateCard.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });

    const created = await createBoq(fd({ title: "Rate card test 1", clientId: clientA }));
    first = (created as { data: { id: string } }).data.id;
    // DSC types only the rate (profit already in it)
    const items = [item({ sellingRate: 156.25 }), item({ item: "Skirting", unit: "rft", quantity: 50, sellingRate: 62.5 }), item({ item: "Brand new item", quantity: 2 })];
    expect((await saveBoqItems(first, JSON.stringify(items))).ok).toBe(true);
    expect((await saveRatesForClient(first)).ok).toBe(true);
    const card = await db.clientRateCard.findUniqueOrThrow({ where: { clientId: clientA }, include: { rates: true } });
    expect(card.rates.map((r) => [r.name, Number(r.rate)]).sort()).toEqual([["Skirting", 62.5], ["Vitrified tile 600x600", 156.25]]); // the row with no rate is not remembered

    second = ((await createBoq(fd({ title: "Rate card test 2", clientId: clientA }))) as { data: { id: string } }).data.id;
    expect((await db.boq.findUniqueOrThrow({ where: { id: second } })).ratesAppliedAt).toBeNull();
    const rows = [item({ item: "VITRIFIED  tile 600X600", quantity: 200 }), item({ item: "Skirting", unit: "rft", quantity: 80 }), item({ item: "Something else", quantity: 3 })];
    expect((await saveBoqItems(second, JSON.stringify(rows))).ok).toBe(true);
    expect((await db.boqItem.findMany({ where: { boqId: second } })).every((i) => Number(i.sellingRate) === 0)).toBe(true); // nothing is filled by itself

    const r = await applyLastRates(second);
    expect(r.ok).toBe(true);
    expect((r as unknown as { data: object }).data).toMatchObject({ exact: 2, worded: 0, left: 1 });
    const filled = await db.boqItem.findMany({ where: { boqId: second }, orderBy: { sortOrder: "asc" } });
    expect(filled.map((i) => Number(i.sellingRate))).toEqual([156.25, 62.5, 0]);
    expect(Number(filled[0].total)).toBe(31250); // 200 x 156.25, worked out by the app
    expect((await db.boq.findUniqueOrThrow({ where: { id: second } })).ratesAppliedAt).not.toBeNull();
  });

  it("can be changed on its own screen: one rate per item; a repeated name is dropped", async () => {
    await loginAs("director@dsc.demo");
    expect((await saveRateCard(clientA, 0, JSON.stringify([{ name: "Vitrified tile 600x600", unit: "sqft", category: "FLOORING", rate: 195 }, { name: "vitrified TILE 600x600", unit: "sqft", rate: 1 }]))).ok).toBe(true);
    const card = await db.clientRateCard.findUniqueOrThrow({ where: { clientId: clientA }, include: { rates: true } });
    expect(card.rates).toHaveLength(1);
    expect(Number(card.rates[0].rate)).toBe(195);
    expect((await saveRateCard(clientA, 20, "not json")).ok).toBe(false);
  });

  it("each client keeps its own: a client with no saved rates gets nothing from another client", async () => {
    await loginAs("director@dsc.demo");
    const third = ((await createBoq(fd({ title: "Rate card test 3" }))) as { data: { id: string } }).data.id;
    expect((await applyLastRates(third)).ok).toBe(false); // no client yet
    expect((await setBoqClient(third, fd({ clientId: clientB }))).ok).toBe(true);
    expect((await applyLastRates(third)).ok).toBe(false); // client B has no saved rates: other clients' are never used
    expect((await skipLastRates(third)).ok).toBe(true);
    expect((await db.boq.findUniqueOrThrow({ where: { id: third } })).ratesAppliedAt).not.toBeNull();
    expect((await setBoqClient(third, fd({ clientId: clientA }))).ok).toBe(true);
    expect((await db.boq.findUniqueOrThrow({ where: { id: third } })).ratesAppliedAt).toBeNull(); // changing the client asks again
  });

  it("is closed to people who may not see rates, and to approved BOQs", async () => {
    for (const email of ["pm@dsc.demo", "designer@dsc.demo", "supervisor@dsc.demo"]) {
      await loginAs(email);
      expect((await applyLastRates(second)).ok).toBe(false);
      expect((await saveRatesForClient(second)).ok).toBe(false);
      expect((await saveRateCard(clientA, 0, "[]")).ok).toBe(false);
    }
    logout();
    expect((await saveRateCard(clientA, 0, "[]")).ok).toBe(false);
    await db.boq.update({ where: { id: second }, data: { status: "APPROVED" } });
    await loginAs("director@dsc.demo");
    expect((await applyLastRates(second)).ok).toBe(false);
    expect((await setBoqClient(second, fd({ clientId: clientB }))).ok).toBe(false);
  });
});
