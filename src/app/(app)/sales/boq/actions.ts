"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import ExcelJS from "exceljs";
import { BoqCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextNumber } from "@/lib/sequence";
import { requestApproval } from "@/lib/workflow";
import { boqItemTotals, boqSummary } from "@/lib/money";
import { formToObject, zOptStr, zReqStr } from "@/lib/form";
import { BOQ_CATEGORIES } from "@/lib/enums";
import { num } from "@/lib/utils";

const itemSchema = z.object({
  id: z.string().optional(),
  category: z.nativeEnum(BoqCategory).default("OTHER"),
  subcategory: z.string().trim().optional(),
  item: zReqStr("Every row needs an item name"),
  description: z.string().trim().optional(),
  specification: z.string().trim().optional(),
  unit: z.string().trim().min(1).default("nos"),
  quantity: z.coerce.number({ message: "Enter a quantity" }).min(0, "Quantity can't be negative"),
  materialCost: z.coerce.number().min(0).default(0),
  labourCost: z.coerce.number().min(0).default(0),
  otherCost: z.coerce.number().min(0).default(0),
  sellingRate: z.coerce.number().min(0).default(0),
  materialId: z.string().optional().nullable(),
});
export type BoqItemInput = z.infer<typeof itemSchema>;

const EDITABLE = ["DRAFT"] as const;

async function load(c: Ctx, id: string) {
  const b = await db.boq.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!b) throw new UserError("BOQ not found.");
  return b;
}

function itemRows(items: BoqItemInput[]) {
  return items.map((i, idx) => {
    const t = boqItemTotals({ quantity: i.quantity, materialCost: i.materialCost, labourCost: i.labourCost, otherCost: i.otherCost, sellingRate: i.sellingRate });
    return {
      sortOrder: idx, category: i.category, subcategory: i.subcategory || null, item: i.item, description: i.description || null,
      specification: i.specification || null, unit: i.unit, quantity: i.quantity, materialCost: i.materialCost, labourCost: i.labourCost,
      otherCost: i.otherCost, sellingRate: i.sellingRate, materialId: i.materialId || null, estimatedCost: t.estimatedCost, total: t.total,
    };
  });
}

const createSchema = z.object({ title: zReqStr("Give the BOQ a title"), projectId: zOptStr, notes: zOptStr });

export async function createBoq(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("boq:create");
    const d = createSchema.parse(formToObject(fd));
    if (d.projectId) {
      const p = await db.project.findFirst({ where: { id: d.projectId, companyId: c.companyId, deletedAt: null } });
      if (!p) throw new UserError("Project not found.");
    }
    const b = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, c.companyId, "BOQ");
      const x = await tx.boq.create({ data: { companyId: c.companyId, number, title: d.title, projectId: d.projectId ?? null, notes: d.notes } });
      await audit(c, { action: "CREATE", entityType: "Boq", entityId: x.id, summary: `Created BOQ ${number} – ${d.title}` }, tx);
      return x;
    });
    revalidatePath("/sales/boq");
    return { message: `BOQ ${b.number} created`, data: { id: b.id } };
  });
}

/** Replaces all items. Users without cost access cannot see or change cost columns – existing costs are preserved. */
export async function saveBoqItems(id: string, itemsJson: string) {
  return run(async () => {
    const c = await assertPerm("boq:edit");
    const b = await load(c, id);
    if (!(EDITABLE as readonly string[]).includes(b.status)) throw new UserError("This BOQ is approved. Create a revision to change it.");
    let raw: unknown;
    try {
      raw = JSON.parse(itemsJson);
    } catch {
      throw new UserError("The item list could not be read. Please reload the page.");
    }
    const parsed = z.array(itemSchema).max(2000, "Too many rows (max 2000)").safeParse(raw);
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    let items = parsed.data;

    if (!c.can("margins:view")) {
      const old = new Map(b.items.map((i) => [i.id, i]));
      items = items.map((i) => {
        const o = i.id ? old.get(i.id) : undefined;
        return { ...i, materialCost: o ? num(o.materialCost) : 0, labourCost: o ? num(o.labourCost) : 0, otherCost: o ? num(o.otherCost) : 0 };
      });
    }
    const rows = itemRows(items);
    const before = boqSummary(b.items.map((i) => ({ estimatedCost: num(i.estimatedCost), total: num(i.total) })));
    const after = boqSummary(rows);
    await db.$transaction(async (tx) => {
      await tx.boqItem.deleteMany({ where: { boqId: id } });
      await tx.boqItem.createMany({ data: rows.map((r) => ({ ...r, boqId: id })) });
      await tx.boq.update({ where: { id }, data: { updatedAt: new Date() } });
      await audit(c, {
        action: "UPDATE", entityType: "Boq", entityId: id,
        summary: `${c.name} saved BOQ ${b.number}: ${rows.length} items, selling ₹${after.revenue.toLocaleString("en-IN")}${before.revenue !== after.revenue ? ` (was ₹${before.revenue.toLocaleString("en-IN")})` : ""}`,
        oldValue: { revenue: before.revenue }, newValue: { revenue: after.revenue },
      }, tx);
    });
    revalidatePath(`/sales/boq/${id}`);
    revalidatePath("/sales/boq");
    return { message: `Saved ${rows.length} items` };
  });
}

export async function submitBoq(id: string) {
  return run(async () => {
    const c = await assertPerm("boq:edit");
    const b = await load(c, id);
    if (b.status !== "DRAFT") throw new UserError("Only draft BOQs can be submitted.");
    if (b.items.length === 0) throw new UserError("Add items before submitting.");
    const s = boqSummary(b.items.map((i) => ({ estimatedCost: num(i.estimatedCost), total: num(i.total) })));
    const r = await db.$transaction(async (tx) => {
      await tx.boq.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      return requestApproval(tx, c, { type: "BOQ", entityType: "Boq", entityId: id, title: `BOQ ${b.number}`, amount: s.revenue });
    });
    revalidatePath(`/sales/boq/${id}`);
    revalidatePath("/sales/boq");
    return { message: r.autoApproved ? "Approved (within your authority)" : "Sent for approval" };
  });
}

/** New revision = copy as BOQ-00012-R2; the old one is marked Revised. Projects always use the latest. */
export async function reviseBoq(id: string) {
  return run(async () => {
    const c = await assertPerm("boq:edit");
    const b = await load(c, id);
    if (!["APPROVED", "PENDING_APPROVAL"].includes(b.status)) throw new UserError("Only approved BOQs need a revision. Draft BOQs can be edited directly.");
    const base = b.number.replace(/-R\d+$/, "");
    const rev = b.revision + 1;
    const copy = await db.$transaction(async (tx) => {
      const number = `${base}-R${rev}`;
      if (await tx.boq.findFirst({ where: { companyId: c.companyId, number } })) throw new UserError("A newer revision already exists.");
      const x = await tx.boq.create({
        data: {
          companyId: c.companyId, number, revision: rev, projectId: b.projectId, quotationId: b.quotationId, title: b.title, notes: b.notes,
          items: { create: b.items.map((i) => ({ sortOrder: i.sortOrder, category: i.category, subcategory: i.subcategory, item: i.item, description: i.description, specification: i.specification, unit: i.unit, quantity: i.quantity, materialCost: i.materialCost, labourCost: i.labourCost, otherCost: i.otherCost, sellingRate: i.sellingRate, materialId: i.materialId, supplierId: i.supplierId, estimatedCost: i.estimatedCost, total: i.total })) },
        },
      });
      await tx.boq.update({ where: { id }, data: { status: "REVISED" } });
      await tx.approval.updateMany({ where: { entityType: "Boq", entityId: id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), remarks: "BOQ revised" } });
      await audit(c, { action: "CREATE", entityType: "Boq", entityId: x.id, summary: `Created revision ${number} from ${b.number}` }, tx);
      return x;
    });
    revalidatePath("/sales/boq");
    return { message: `Revision ${copy.number} created`, data: { id: copy.id } };
  });
}

export async function deleteBoq(id: string) {
  return run(async () => {
    const c = await assertPerm("boq:delete");
    const b = await load(c, id);
    if (b.status !== "DRAFT") throw new UserError("Only draft BOQs can be deleted.");
    const used = await db.quotation.count({ where: { boqId: id, deletedAt: null } });
    if (used) throw new UserError("A quotation is linked to this BOQ, so it can't be deleted.");
    await db.boq.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(c, { action: "DELETE", entityType: "Boq", entityId: id, summary: `Deleted BOQ ${b.number}` });
    revalidatePath("/sales/boq");
    return { message: "BOQ deleted" };
  });
}

// ───────── Excel import ─────────
const HEADERS: Record<string, keyof BoqItemInput> = {
  category: "category", subcategory: "subcategory", "sub category": "subcategory", item: "item", "item name": "item", description: "description",
  specification: "specification", spec: "specification", unit: "unit", quantity: "quantity", qty: "quantity",
  "material cost": "materialCost", material: "materialCost", "labour cost": "labourCost", labour: "labourCost", "other cost": "otherCost", other: "otherCost",
  "selling rate": "sellingRate", rate: "sellingRate", "selling price": "sellingRate",
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return String(v.result);
    if ("text" in v) return String(v.text);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    return "";
  }
  return String(v).trim();
}

function matchCategory(s: string): BoqCategory {
  const k = s.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (BOQ_CATEGORIES as readonly string[]).includes(k) ? (k as BoqCategory) : "OTHER";
}

export async function importBoqItems(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("boq:edit");
    const b = await load(c, id);
    if (b.status !== "DRAFT") throw new UserError("Only draft BOQs can be imported into.");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose an Excel (.xlsx) file.");
    if (!file.name.toLowerCase().endsWith(".xlsx")) throw new UserError("Only .xlsx files are supported. Download the template for the right format.");
    if (file.size > 5 * 1024 * 1024) throw new UserError("File is too large (max 5 MB).");

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
    } catch {
      throw new UserError("That file couldn't be read as an Excel workbook.");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new UserError("The workbook is empty.");

    // find the header row within the first 10 rows
    let headerRow = 0;
    let map: Record<number, keyof BoqItemInput> = {};
    for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
      const m: Record<number, keyof BoqItemInput> = {};
      ws.getRow(r).eachCell((cell, col) => {
        const key = HEADERS[cellText(cell.value).toLowerCase()];
        if (key) m[col] = key;
      });
      if (Object.values(m).includes("item") && Object.values(m).includes("quantity")) {
        headerRow = r;
        map = m;
      }
    }
    if (!headerRow) throw new UserError("Couldn't find the header row. It needs at least “Item” and “Quantity” columns. Download the template.");

    const parsed: BoqItemInput[] = [];
    const problems: string[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rec: Record<string, unknown> = {};
      for (const [col, key] of Object.entries(map)) rec[key] = cellText(row.getCell(Number(col)).value);
      if (!rec.item) continue; // blank/total rows
      const canCost = c.can("margins:view");
      const r1 = itemSchema.safeParse({
        ...rec, category: matchCategory(String(rec.category ?? "")), unit: rec.unit || "nos",
        quantity: String(rec.quantity ?? "").replace(/,/g, "") || "0",
        materialCost: canCost ? String(rec.materialCost ?? "").replace(/,/g, "") || 0 : 0,
        labourCost: canCost ? String(rec.labourCost ?? "").replace(/,/g, "") || 0 : 0,
        otherCost: canCost ? String(rec.otherCost ?? "").replace(/,/g, "") || 0 : 0,
        sellingRate: String(rec.sellingRate ?? "").replace(/,/g, "") || 0,
      });
      if (r1.success) parsed.push(r1.data);
      else problems.push(`Row ${r}: ${r1.error.issues[0].message}`);
      if (problems.length >= 5) break;
    }
    if (problems.length) throw new UserError(`Fix these rows and try again – ${problems.join("; ")}`);
    if (!parsed.length) throw new UserError("No item rows found under the header.");

    const rows = itemRows(parsed);
    const start = b.items.length;
    await db.$transaction(async (tx) => {
      await tx.boqItem.createMany({ data: rows.map((r, i) => ({ ...r, sortOrder: start + i, boqId: id })) });
      await audit(c, { action: "UPDATE", entityType: "Boq", entityId: id, summary: `Imported ${rows.length} items into BOQ ${b.number} from Excel` }, tx);
    });
    revalidatePath(`/sales/boq/${id}`);
    return { message: `Imported ${rows.length} items` };
  });
}
