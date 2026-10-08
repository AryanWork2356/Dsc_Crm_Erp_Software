"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextNumber } from "@/lib/sequence";
import { move, siteLocation } from "@/lib/inventory";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { projectScope } from "@/lib/scope";
import { formToObject, zDate, zOptDate, zOptStr, zReqStr } from "@/lib/form";
import { num } from "@/lib/utils";

function revalidate() {
  for (const p of ["/inventory/stock", "/inventory/movements", "/inventory/receipts", "/inventory/issues", "/inventory/materials", "/procurement/orders", "/procurement/deliveries", "/dashboard"]) revalidatePath(p);
}

async function projectOk(c: Ctx, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) } });
  if (!p) throw new UserError("Project not found or you don't have access to it.");
  return p;
}

function json<T>(raw: unknown, schema: z.ZodType<T>): T {
  let v: unknown;
  try {
    v = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new UserError("The item list could not be read. Please reload the page.");
  }
  const r = schema.safeParse(v);
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Invalid items");
  return r.data;
}

// ───────────── Locations ─────────────
export async function createWarehouse(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("inventory:create");
    const d = z.object({ name: zReqStr("Name is required"), address: zOptStr }).parse(formToObject(fd));
    if (await db.warehouse.findFirst({ where: { companyId: c.companyId, name: d.name, type: "WAREHOUSE" } })) throw new UserError("A warehouse with this name already exists.");
    const w = await db.warehouse.create({ data: { companyId: c.companyId, name: d.name, address: d.address, type: "WAREHOUSE" } });
    await audit(c, { action: "CREATE", entityType: "Warehouse", entityId: w.id, summary: `Created warehouse ${d.name}` });
    revalidatePath("/inventory/locations");
    return { message: "Warehouse created" };
  });
}

// ───────────── Goods receipt (against a PO) ─────────────
const receiptItem = z.object({
  poItemId: z.string().min(1),
  receivedQty: z.coerce.number().min(0, "Quantities can't be negative"),
  damagedQty: z.coerce.number().min(0).default(0),
  rejectedQty: z.coerce.number().min(0).default(0),
});

const receiptSchema = z.object({
  poId: zReqStr("Select the purchase order"),
  locationId: zReqStr("Choose where the material is delivered"),
  deliveryDate: zDate("Pick the delivery date"),
  challanNo: zOptStr,
  vehicleNo: zOptStr,
  remarks: zOptStr,
});

export async function createReceipt(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("inventory:create");
    const raw = formToObject(fd);
    const d = receiptSchema.parse(raw);
    const lines = json(raw.items, z.array(receiptItem)).filter((l) => l.receivedQty > 0);
    if (!lines.length) throw new UserError("Enter the quantity received for at least one item.");

    const result = await db.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({ where: { id: d.poId, companyId: c.companyId }, include: { items: true, vendor: true } });
      if (!po) throw new UserError("Purchase order not found.");
      if (!["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"].includes(po.status)) throw new UserError(`Material can't be received against an order that is ${po.status.toLowerCase().replace(/_/g, " ")}.`);
      const loc = await tx.warehouse.findFirst({ where: { id: d.locationId, companyId: c.companyId, isActive: true } });
      if (!loc) throw new UserError("Delivery location not found.");

      const number = await nextNumber(tx, c.companyId, "GRN");
      const receipt = await tx.materialReceipt.create({ data: { companyId: c.companyId, number, poId: po.id, locationId: loc.id, deliveryDate: d.deliveryDate, challanNo: d.challanNo, vehicleNo: d.vehicleNo, remarks: d.remarks, receivedById: c.userId } });

      let acceptedTotal = 0;
      for (const l of lines) {
        const item = po.items.find((i) => i.id === l.poItemId);
        if (!item) throw new UserError("An item doesn't belong to this purchase order.");
        if (l.damagedQty + l.rejectedQty > l.receivedQty) throw new UserError(`${item.description}: damaged + rejected can't exceed received.`);
        const accepted = l.receivedQty - l.damagedQty - l.rejectedQty;
        const pending = num(item.quantity) - num(item.receivedQty);
        if (accepted > pending + 1e-9) throw new UserError(`${item.description}: only ${pending} ${item.unit} still pending on this order (you entered ${accepted}).`);
        await tx.materialReceiptItem.create({ data: { receiptId: receipt.id, poItemId: item.id, materialId: item.materialId, orderedQty: item.quantity, receivedQty: l.receivedQty, damagedQty: l.damagedQty, rejectedQty: l.rejectedQty, acceptedQty: accepted } });
        if (accepted > 0) {
          await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: { increment: accepted } } });
          acceptedTotal += accepted;
          // Items without a catalogue material can't be stocked – they're recorded on the receipt only.
          if (item.materialId) {
            await move(tx, c, { type: "INWARD", materialId: item.materialId, quantity: accepted, unitCost: num(item.rate), toLocationId: loc.id, projectId: loc.projectId ?? po.projectId, refType: "MATERIAL_RECEIPT", refId: receipt.id, note: `${number} against ${po.number}` });
            await tx.material.update({ where: { id: item.materialId }, data: { purchaseCost: item.rate } });
          }
        }
      }

      const fresh = await tx.purchaseOrderItem.findMany({ where: { poId: po.id } });
      const complete = fresh.every((i) => num(i.receivedQty) + 1e-9 >= num(i.quantity));
      const newStatus = complete ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: newStatus } });

      await audit(c, { action: "CREATE", entityType: "MaterialReceipt", entityId: receipt.id, summary: `Received material against ${po.number} from ${po.vendor.name} at ${loc.name} (${number}) – PO now ${newStatus.toLowerCase().replace(/_/g, " ")}` }, tx);
      // Automation: material received → tell the project manager + procurement
      const pm = po.projectId ? (await tx.project.findUnique({ where: { id: po.projectId }, select: { projectManagerId: true } }))?.projectManagerId : null;
      if (pm && pm !== c.userId) await notifyUsers([pm], { companyId: c.companyId, type: "MATERIAL_RECEIVED", title: `Material received for ${po.number}`, body: `${po.vendor.name} · ${newStatus === "RECEIVED" ? "complete" : "partial delivery"}`, link: `/procurement/orders/${po.id}` }, tx);
      await notifyRoles(c.companyId, ["PROCUREMENT"], { type: "MATERIAL_RECEIVED", title: `${po.number} ${newStatus === "RECEIVED" ? "fully received" : "partially received"}`, link: `/procurement/orders/${po.id}`, dedupeKey: `grn:${receipt.id}` }, tx);
      return { receipt, status: newStatus, acceptedTotal };
    });
    revalidate();
    return { message: `${result.receipt.number} recorded – order ${result.status === "RECEIVED" ? "fully received" : "partially received"}`, data: { id: result.receipt.id } };
  });
}

// ───────────── Issue to site / return ─────────────
const issueItem = z.object({ materialId: z.string().min(1), quantity: z.coerce.number().positive("Quantity must be above 0") });
const issueSchema = z.object({
  projectId: zReqStr("Select the project"),
  fromLocationId: zReqStr("Choose the warehouse to issue from"),
  receivedBy: zOptStr,
  purpose: zOptStr,
  date: zOptDate,
});

export async function createIssue(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("inventory:create");
    const raw = formToObject(fd);
    const d = issueSchema.parse(raw);
    const lines = json(raw.items, z.array(issueItem).min(1, "Add at least one material"));
    const project = await projectOk(c, d.projectId);
    if (["COMPLETED", "CANCELLED"].includes(project.status)) throw new UserError("You can't issue material to a completed or cancelled project.");
    const dupe = new Set(lines.map((l) => l.materialId));
    if (dupe.size !== lines.length) throw new UserError("A material appears twice. Combine the quantities.");

    const issue = await db.$transaction(async (tx) => {
      const from = await tx.warehouse.findFirst({ where: { id: d.fromLocationId, companyId: c.companyId, isActive: true, type: "WAREHOUSE" } });
      if (!from) throw new UserError("Issue from a warehouse (not a site).");
      const toId = await siteLocation(tx, c.companyId, d.projectId);
      const number = await nextNumber(tx, c.companyId, "MIN");
      const rec = await tx.materialIssue.create({ data: { companyId: c.companyId, number, projectId: d.projectId, fromLocationId: from.id, toLocationId: toId, issuedById: c.userId, receivedBy: d.receivedBy, purpose: d.purpose, date: d.date ?? new Date() } });
      for (const l of lines) {
        const { unitCost } = await move(tx, c, { type: "OUTWARD", materialId: l.materialId, quantity: l.quantity, fromLocationId: from.id, toLocationId: toId, projectId: d.projectId, refType: "MATERIAL_ISSUE", refId: rec.id, note: `${number} to ${project.code}` });
        await tx.materialIssueItem.create({ data: { issueId: rec.id, materialId: l.materialId, quantity: l.quantity, unitCost } });
      }
      await audit(c, { action: "CREATE", entityType: "MaterialIssue", entityId: rec.id, summary: `${lines.length} material line(s) issued to project ${project.code} (${number})` }, tx);
      return rec;
    });
    revalidate();
    revalidatePath(`/projects/${d.projectId}`);
    return { message: `${issue.number} issued to site`, data: { id: issue.id } };
  });
}

/** Unused material goes back from the site to a warehouse; the project is credited at the cost it was charged. */
export async function createReturn(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("inventory:create");
    const raw = formToObject(fd);
    const d = z.object({ projectId: zReqStr("Select the project"), toLocationId: zReqStr("Choose the warehouse receiving the return"), note: zOptStr }).parse(raw);
    const lines = json(raw.items, z.array(issueItem).min(1, "Add at least one material"));
    const project = await projectOk(c, d.projectId);
    await db.$transaction(async (tx) => {
      const to = await tx.warehouse.findFirst({ where: { id: d.toLocationId, companyId: c.companyId, isActive: true, type: "WAREHOUSE" } });
      if (!to) throw new UserError("Return to a warehouse.");
      const site = await siteLocation(tx, c.companyId, d.projectId);
      const number = await nextNumber(tx, c.companyId, "MIN");
      const rec = await tx.materialIssue.create({ data: { companyId: c.companyId, number, projectId: d.projectId, fromLocationId: site, toLocationId: to.id, issuedById: c.userId, purpose: `RETURN${d.note ? ` – ${d.note}` : ""}` } });
      for (const l of lines) {
        const { unitCost } = await move(tx, c, { type: "RETURN", materialId: l.materialId, quantity: l.quantity, fromLocationId: site, toLocationId: to.id, projectId: d.projectId, refType: "MATERIAL_ISSUE", refId: rec.id, note: `Return ${number} from ${project.code}` });
        await tx.materialIssueItem.create({ data: { issueId: rec.id, materialId: l.materialId, quantity: -l.quantity, unitCost } }); // negative = credit to the project
      }
      await audit(c, { action: "CREATE", entityType: "MaterialIssue", entityId: rec.id, summary: `Returned ${lines.length} material line(s) from ${project.code} to ${to.name} (${number})` }, tx);
    });
    revalidate();
    revalidatePath(`/projects/${d.projectId}`);
    return { message: "Return recorded" };
  });
}

// ───────────── Manual movements ─────────────
const manualSchema = z.object({
  type: z.enum(["TRANSFER", "ADJUSTMENT_ADD", "ADJUSTMENT_REMOVE", "DAMAGED", "CONSUMED"]),
  materialId: zReqStr("Select the material"),
  quantity: z.coerce.number({ message: "Enter a quantity" }).positive("Quantity must be above 0"),
  fromLocationId: zOptStr,
  toLocationId: zOptStr,
  unitCost: z.coerce.number().min(0).optional(),
  note: zOptStr,
});

export async function recordMovement(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("inventory:create");
    const d = manualSchema.parse(formToObject(fd));
    if ((d.type === "ADJUSTMENT_ADD" || d.type === "ADJUSTMENT_REMOVE" || d.type === "DAMAGED") && !d.note) throw new UserError("Please give a reason in the note – adjustments are audited.");
    const type = d.type.startsWith("ADJUSTMENT") ? "ADJUSTMENT" : d.type;
    await db.$transaction(async (tx) => {
      const mat = await tx.material.findFirst({ where: { id: d.materialId, companyId: c.companyId } });
      const loc = d.fromLocationId ? await tx.warehouse.findUnique({ where: { id: d.fromLocationId } }) : null;
      await move(tx, c, {
        type: type as never, materialId: d.materialId, quantity: d.quantity,
        fromLocationId: d.type === "ADJUSTMENT_ADD" ? null : d.fromLocationId, toLocationId: d.type === "ADJUSTMENT_ADD" ? d.toLocationId ?? d.fromLocationId : d.type === "TRANSFER" ? d.toLocationId : null,
        unitCost: d.unitCost ?? num(mat?.purchaseCost), projectId: loc?.projectId ?? null, note: d.note,
      });
      await audit(c, { action: "CREATE", entityType: "InventoryTransaction", summary: `${d.type.replace("_", " ").toLowerCase()}: ${d.quantity} × ${mat?.name}${d.note ? ` – ${d.note}` : ""}` }, tx);
    });
    revalidate();
    return { message: "Stock updated" };
  });
}
