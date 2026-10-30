"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BoqCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { boqItemTotals } from "@/lib/money";
import { formToObject, zReqStr } from "@/lib/form";
import { num } from "@/lib/utils";
import { closeRate, findRate, rateKey, sellFromCost } from "@/lib/rate-card";

/** Rate cards hold DSC's costs and profit, so only people who may see margins can use them. */
async function costPerm(perm: "boq:edit" | "boq:view") {
  const c = await assertPerm(perm);
  if (!c.can("margins:view")) throw new UserError("You don't have access to costs and profit.");
  return c;
}

async function draftBoq(c: Ctx, id: string) {
  const b = await db.boq.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!b) throw new UserError("BOQ not found.");
  if (b.status !== "DRAFT") throw new UserError("This BOQ is approved. Create a revision to change it.");
  return b;
}

const pct = z.coerce.number({ message: "Enter the profit %" }).min(0, "Profit can't be negative").max(500, "That profit % looks too high");

/** Says which client this BOQ is for (any editor may do this; no costs are involved). */
export async function setBoqClient(boqId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("boq:edit");
    const b = await draftBoq(c, boqId);
    const { clientId } = z.object({ clientId: zReqStr("Choose the client") }).parse(formToObject(fd));
    const client = await db.client.findFirst({ where: { id: clientId, companyId: c.companyId, deletedAt: null }, include: { rateCard: true } });
    if (!client) throw new UserError("Client not found.");
    const changed = b.clientId !== clientId;
    await db.boq.update({
      where: { id: boqId },
      data: { clientId, ...(changed ? { ratesAppliedAt: null, profitPct: client.rateCard ? client.rateCard.profitPct : null } : {}) },
    });
    await audit(c, { action: "UPDATE", entityType: "Boq", entityId: boqId, summary: `BOQ ${b.number} is for ${client.name}` });
    revalidatePath(`/sales/boq/${boqId}`);
    return { message: `BOQ is now for ${client.name}` };
  });
}

/**
 * "Use the rates we already have": fills every row the app knows, and prices it at the client's profit %.
 *   1. this client's saved rate for the same item (exact): filled, nothing to check;
 *   2. this client's saved rate for the same item worded differently ("Providing and fixing 18 mm ply" = "Supply & fix 18mm plywood");
 *   3. another client's saved rate for the same item (exact or worded differently): the most recent card wins.
 * Rows filled by 2 or 3 carry a note saying where the rate came from, so a person checks them. Only truly new items stay empty.
 */
export async function applyLastRates(boqId: string) {
  return run(async () => {
    const c = await costPerm("boq:edit");
    const b = await draftBoq(c, boqId);
    if (!b.clientId) throw new UserError("Choose the client first.");
    const cards = await db.clientRateCard.findMany({ where: { companyId: c.companyId }, include: { rates: true, client: { select: { name: true } } }, orderBy: { updatedAt: "desc" } });
    const own = cards.find((k) => k.clientId === b.clientId);
    const others = cards.filter((k) => k.clientId !== b.clientId);
    if (!own?.rates.length && !others.some((k) => k.rates.length)) throw new UserError("No client has saved rates yet. Fill this BOQ's rates, then press Save rates for next time.");
    const asNum = (k: (typeof cards)[number]) => k.rates.map((r) => ({ ...r, materialRate: num(r.materialRate), labourRate: num(r.labourRate), otherRate: num(r.otherRate), from: k.client.name }));
    const ownRates = own ? asNum(own) : [];
    const otherRates = others.flatMap(asNum);
    const profit = own ? num(own.profitPct) : b.profitPct !== null ? num(b.profitPct) : others[0] ? num(others[0].profitPct) : 0;
    const counts = { exact: 0, worded: 0, otherClient: 0 };
    await db.$transaction(async (tx) => {
      for (const i of b.items) {
        let r: (typeof ownRates)[number] | undefined = findRate(ownRates, i.item, i.unit);
        let note: string | null = null;
        if (r) counts.exact++;
        else {
          const close = closeRate(ownRates, i.item, i.unit);
          const otherExact = close ? undefined : findRate(otherRates, i.item, i.unit);
          const otherClose = close || otherExact ? undefined : closeRate(otherRates, i.item, i.unit);
          r = close?.rate ?? otherExact ?? otherClose?.rate;
          if (!r) continue;
          if (close) { counts.worded++; note = `Same as “${r.name}” (worded differently). Check the rate.`; }
          else { counts.otherClient++; note = `Rate from ${r.from}: “${r.name}”${otherClose ? " (worded differently)" : ""}. Check it suits this client.`; }
        }
        const cost = r.materialRate + r.labourRate + r.otherRate;
        const sellingRate = sellFromCost(cost, profit);
        const t = boqItemTotals({ quantity: num(i.quantity), materialCost: r.materialRate, labourCost: r.labourRate, otherCost: r.otherRate, sellingRate });
        await tx.boqItem.update({ where: { id: i.id }, data: { materialCost: r.materialRate, labourCost: r.labourRate, otherCost: r.otherRate, sellingRate, estimatedCost: t.estimatedCost, total: t.total, rateNote: note?.slice(0, 300) ?? null } });
      }
      await tx.boq.update({ where: { id: boqId }, data: { profitPct: profit, ratesAppliedAt: new Date() } });
      await audit(c, { action: "UPDATE", entityType: "Boq", entityId: boqId, summary: `Filled saved rates: ${counts.exact} exact, ${counts.worded} worded differently, ${counts.otherClient} from other clients, of ${b.items.length} rows; profit ${profit}%` }, tx);
    });
    revalidatePath(`/sales/boq/${boqId}`);
    const filled = counts.exact + counts.worded + counts.otherClient;
    const left = b.items.length - filled;
    const check = counts.worded + counts.otherClient;
    return { message: `Filled ${filled} of ${b.items.length} rows at ${profit}% profit.${check ? ` ${check} are marked “check” (worded differently or from another client).` : ""}${left ? ` ${left} are new – enter their rates.` : ""}`, data: { ...counts, left } };
  });
}

/** "Start fresh": stop asking for this BOQ. */
export async function skipLastRates(boqId: string) {
  return run(async () => {
    const c = await costPerm("boq:edit");
    await draftBoq(c, boqId);
    await db.boq.update({ where: { id: boqId }, data: { ratesAppliedAt: new Date() } });
    revalidatePath(`/sales/boq/${boqId}`);
    return { message: "OK, starting fresh" };
  });
}

/** Remembers this BOQ's costs (and profit %) as the client's rate card for next time. Saved BOQ rows are used. */
export async function saveRatesForClient(boqId: string, profitPct: number) {
  return run(async () => {
    const c = await costPerm("boq:edit");
    const p = pct.parse(profitPct);
    const b = await draftBoq(c, boqId);
    if (!b.clientId) throw new UserError("Choose the client first.");
    const rows = b.items.filter((i) => num(i.materialCost) + num(i.labourCost) + num(i.otherCost) > 0 && rateKey(i.item));
    const clientId = b.clientId;
    await db.$transaction(async (tx) => {
      const card = await tx.clientRateCard.upsert({
        where: { clientId },
        create: { companyId: c.companyId, clientId, profitPct: p, updatedBy: c.name },
        update: { profitPct: p, updatedBy: c.name },
      });
      for (const i of rows) {
        const data = { name: i.item, category: i.category, materialRate: i.materialCost, labourRate: i.labourCost, otherRate: i.otherCost };
        await tx.clientRate.upsert({ where: { cardId_nameKey_unit: { cardId: card.id, nameKey: rateKey(i.item), unit: i.unit } }, create: { cardId: card.id, nameKey: rateKey(i.item), unit: i.unit, ...data }, update: data });
      }
      await tx.boq.update({ where: { id: boqId }, data: { profitPct: p, ratesAppliedAt: b.ratesAppliedAt ?? new Date() } });
      await audit(c, { action: "UPDATE", entityType: "ClientRateCard", entityId: card.id, summary: `${c.name} saved ${rows.length} rates and ${p}% profit for the client from BOQ ${b.number}` }, tx);
    });
    revalidatePath(`/sales/boq/${boqId}`);
    revalidatePath("/sales/rates");
    return { message: `Saved ${rows.length} rates at ${p}% profit for next time` };
  });
}

const rateRow = z.object({
  name: zReqStr("Every rate needs a name"),
  unit: z.string().trim().min(1).default("nos"),
  category: z.nativeEnum(BoqCategory).default("OTHER"),
  materialRate: z.coerce.number().min(0).default(0),
  labourRate: z.coerce.number().min(0).default(0),
  otherRate: z.coerce.number().min(0).default(0),
});

/** The rate card screen: replaces the client's whole list and profit %. */
export async function saveRateCard(clientId: string, profitPct: number, ratesJson: string) {
  return run(async () => {
    const c = await costPerm("boq:edit");
    const p = pct.parse(profitPct);
    const client = await db.client.findFirst({ where: { id: clientId, companyId: c.companyId, deletedAt: null } });
    if (!client) throw new UserError("Client not found.");
    let raw: unknown;
    try {
      raw = JSON.parse(ratesJson);
    } catch {
      throw new UserError("The list could not be read. Please reload the page.");
    }
    const parsed = z.array(rateRow).max(1000, "Too many rows (max 1000)").safeParse(raw);
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const seen = new Set<string>();
    const rows = parsed.data.filter((r) => {
      const key = `${rateKey(r.name)}|${r.unit}`;
      if (!rateKey(r.name) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await db.$transaction(async (tx) => {
      const card = await tx.clientRateCard.upsert({
        where: { clientId },
        create: { companyId: c.companyId, clientId, profitPct: p, updatedBy: c.name },
        update: { profitPct: p, updatedBy: c.name },
      });
      await tx.clientRate.deleteMany({ where: { cardId: card.id } });
      await tx.clientRate.createMany({ data: rows.map((r) => ({ cardId: card.id, nameKey: rateKey(r.name), ...r })) });
      await audit(c, { action: "UPDATE", entityType: "ClientRateCard", entityId: card.id, summary: `${c.name} saved ${client.name}'s rate card: ${rows.length} rates, profit ${p}%` }, tx);
    });
    revalidatePath("/sales/rates");
    revalidatePath(`/sales/rates/${clientId}`);
    return { message: `Saved ${rows.length} rates` };
  });
}
