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
 * "Use this client's saved rates" (only when someone presses it): fills the rows this client has had before, at the rate DSC quoted.
 *   1. the same item, same wording: filled, nothing to check;
 *   2. the same item worded differently ("Providing and fixing 18 mm ply" = "Supply & fix 18mm plywood"): filled and marked "check",
 *      because similar words can still mean a different thing. Once checked and saved for the client, it matches exactly next time.
 * Anything else stays EMPTY: no guessing, and no rates from other clients.
 */
export async function applyLastRates(boqId: string) {
  return run(async () => {
    const c = await costPerm("boq:edit");
    const b = await draftBoq(c, boqId);
    if (!b.clientId) throw new UserError("Choose the client first.");
    const card = await db.clientRateCard.findUnique({ where: { clientId: b.clientId }, include: { rates: true } });
    if (!card?.rates.length) throw new UserError("This client has no saved rates yet. Type the rates, then press Save rates for this client.");
    const profit = num(card.profitPct);
    const rates = card.rates.map((r) => ({ ...r, materialRate: num(r.materialRate), labourRate: num(r.labourRate), otherRate: num(r.otherRate), rate: num(r.rate) }));
    const counts = { exact: 0, worded: 0 };
    await db.$transaction(async (tx) => {
      for (const i of b.items) {
        let r: (typeof rates)[number] | undefined = findRate(rates, i.item, i.unit);
        let note: string | null = null;
        if (r) counts.exact++;
        else {
          const close = closeRate(rates, i.item, i.unit);
          if (!close) continue; // a new item: left empty
          r = close.rate; counts.worded++;
          note = `Same as “${r.name}” (worded differently)? Check the rate.`;
        }
        // the saved rate is what DSC quoted; an old card (no rate) is priced as cost + its profit %
        const sellingRate = r.rate > 0 ? r.rate : sellFromCost(r.materialRate + r.labourRate + r.otherRate, profit);
        const costs = r.rate > 0 ? { materialCost: 0, labourCost: 0, otherCost: 0 } : { materialCost: r.materialRate, labourCost: r.labourRate, otherCost: r.otherRate };
        const t = boqItemTotals({ quantity: num(i.quantity), ...costs, sellingRate });
        await tx.boqItem.update({ where: { id: i.id }, data: { ...costs, sellingRate, estimatedCost: t.estimatedCost, total: t.total, rateNote: note?.slice(0, 300) ?? null } });
      }
      await tx.boq.update({ where: { id: boqId }, data: { ratesAppliedAt: new Date() } });
      await audit(c, { action: "UPDATE", entityType: "Boq", entityId: boqId, summary: `Used the client's saved rates: ${counts.exact} same, ${counts.worded} worded differently, of ${b.items.length} rows` }, tx);
    });
    revalidatePath(`/sales/boq/${boqId}`);
    const filled = counts.exact + counts.worded;
    const left = b.items.length - filled;
    return { message: `Filled ${filled} of ${b.items.length} rows.${counts.worded ? ` ${counts.worded} are marked “check” (worded differently).` : ""}${left ? ` ${left} are new – type their rates.` : ""}`, data: { ...counts, left } };
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

/** Remembers this BOQ's rates as the client's rates for next time (rows with a rate; the last rate typed for an item wins). */
export async function saveRatesForClient(boqId: string, _profitPct?: number | null) {
  return run(async () => {
    const c = await costPerm("boq:edit");
    const b = await draftBoq(c, boqId);
    if (!b.clientId) throw new UserError("Choose the client first.");
    const rows = b.items.filter((i) => num(i.sellingRate) > 0 && rateKey(i.item));
    if (!rows.length) throw new UserError("Type the rates first, and Save.");
    const clientId = b.clientId;
    await db.$transaction(async (tx) => {
      const card = await tx.clientRateCard.upsert({ where: { clientId }, create: { companyId: c.companyId, clientId, profitPct: 0, updatedBy: c.name }, update: { updatedBy: c.name } });
      for (const i of rows) {
        const data = { name: i.item, category: i.category, rate: i.sellingRate, materialRate: 0, labourRate: 0, otherRate: 0 };
        await tx.clientRate.upsert({ where: { cardId_nameKey_unit: { cardId: card.id, nameKey: rateKey(i.item), unit: i.unit } }, create: { cardId: card.id, nameKey: rateKey(i.item), unit: i.unit, ...data }, update: data });
      }
      await tx.boq.update({ where: { id: boqId }, data: { ratesAppliedAt: b.ratesAppliedAt ?? new Date() } });
      await audit(c, { action: "UPDATE", entityType: "ClientRateCard", entityId: card.id, summary: `${c.name} saved ${rows.length} rates for the client from BOQ ${b.number}` }, tx);
    });
    revalidatePath(`/sales/boq/${boqId}`);
    revalidatePath("/sales/rates");
    return { message: `Saved ${rows.length} rates for this client. Next time, press “Use this client's saved rates”.` };
  });
}

const rateRow = z.object({
  name: zReqStr("Every rate needs a name"),
  unit: z.string().trim().min(1).default("nos"),
  category: z.nativeEnum(BoqCategory).default("OTHER"),
  materialRate: z.coerce.number().min(0).default(0),
  labourRate: z.coerce.number().min(0).default(0),
  otherRate: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).default(0),
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
