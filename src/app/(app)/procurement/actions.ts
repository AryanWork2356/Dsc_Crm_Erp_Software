"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BoqCategory, Priority } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextDocNumber, nextNumber } from "@/lib/sequence";
import { requestApproval } from "@/lib/workflow";
import { computeTotals } from "@/lib/money";
import { projectScope } from "@/lib/scope";
import { formToObject, zEmail, zGstin, zNumPos, zOptDate, zOptStr, zPan, zPhone, zReqStr } from "@/lib/form";
import { num } from "@/lib/utils";

// ───────────────────────── VENDORS ─────────────────────────
const vendorSchema = z.object({
  name: zReqStr("Vendor name is required"),
  contactPerson: zOptStr,
  phone: zPhone,
  whatsapp: zPhone,
  email: zEmail,
  address: zOptStr,
  gstin: zGstin,
  pan: zPan,
  bankDetails: zOptStr,
  categories: zOptStr,
  rating: z.coerce.number().int().min(1, "Rating is 1 to 5").max(5, "Rating is 1 to 5").optional(),
  notes: zOptStr,
});

export async function createVendor(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("vendors:create");
    const d = vendorSchema.parse(formToObject(fd));
    if (!c.can("vendor_bills:view")) delete d.bankDetails; // bank details are finance-sensitive
    const dup = d.gstin ? await db.vendor.findFirst({ where: { companyId: c.companyId, gstin: d.gstin, deletedAt: null } }) : null;
    if (dup) throw new UserError(`A vendor with this GSTIN already exists (${dup.name}).`);
    const v = await db.$transaction(async (tx) => {
      const code = await nextNumber(tx, c.companyId, "V");
      const x = await tx.vendor.create({ data: { ...d, companyId: c.companyId, code } });
      await audit(c, { action: "CREATE", entityType: "Vendor", entityId: x.id, summary: `Created vendor ${code} – ${d.name}` }, tx);
      return x;
    });
    revalidatePath("/procurement/vendors");
    return { message: `Vendor ${v.code} created`, data: { id: v.id } };
  });
}

export async function updateVendor(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("vendors:edit");
    const d = vendorSchema.parse(formToObject(fd));
    const old = await db.vendor.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!old) throw new UserError("Vendor not found.");
    if (d.gstin && d.gstin !== old.gstin) {
      const dup = await db.vendor.findFirst({ where: { companyId: c.companyId, gstin: d.gstin, deletedAt: null, id: { not: id } } });
      if (dup) throw new UserError(`Another vendor already uses this GSTIN (${dup.name}).`);
    }
    const data = { ...d, ...(c.can("vendor_bills:view") ? {} : { bankDetails: old.bankDetails ?? undefined }) };
    await db.vendor.update({ where: { id }, data });
    await audit(c, { action: "UPDATE", entityType: "Vendor", entityId: id, summary: `Updated vendor ${old.code} – ${old.name}`, oldValue: { name: old.name, gstin: old.gstin, phone: old.phone } , newValue: { name: d.name, gstin: d.gstin, phone: d.phone } });
    revalidatePath("/procurement/vendors");
    revalidatePath(`/procurement/vendors/${id}`);
    return { message: "Vendor updated" };
  });
}

export async function deleteVendor(id: string) {
  return run(async () => {
    const c = await assertPerm("vendors:delete");
    const v = await db.vendor.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!v) throw new UserError("Vendor not found.");
    const used = (await db.purchaseOrder.count({ where: { vendorId: id } })) + (await db.vendorBill.count({ where: { vendorId: id } }));
    if (used) throw new UserError("This vendor has purchase orders or bills. Their history is kept – it can't be deleted.");
    await db.vendor.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(c, { action: "DELETE", entityType: "Vendor", entityId: id, summary: `Deleted vendor ${v.code} – ${v.name}` });
    revalidatePath("/procurement/vendors");
    return { message: "Vendor deleted" };
  });
}

// ───────────────────────── MATERIALS ─────────────────────────
const materialSchema = z.object({
  name: zReqStr("Material name is required"),
  sku: zOptStr,
  category: z.nativeEnum(BoqCategory).default("OTHER"),
  unit: z.string().trim().min(1).default("nos"),
  minStock: zNumPos().default(0),
  reorderLevel: zNumPos().default(0),
  purchaseCost: zNumPos().default(0),
  vendorId: zOptStr,
});

export async function createMaterial(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("materials:create");
    const d = materialSchema.parse(formToObject(fd));
    if (d.reorderLevel < d.minStock) throw new UserError("Reorder level should be at least the minimum stock.");
    const m = await db.$transaction(async (tx) => {
      const sku = d.sku || (await nextNumber(tx, c.companyId, "MAT"));
      const dup = await tx.material.findFirst({ where: { companyId: c.companyId, sku, deletedAt: null } });
      if (dup) throw new UserError(`SKU ${sku} is already used by ${dup.name}.`);
      const x = await tx.material.create({ data: { ...d, sku, companyId: c.companyId, vendorId: d.vendorId ?? null } });
      await audit(c, { action: "CREATE", entityType: "Material", entityId: x.id, summary: `Added material ${sku} – ${d.name}` }, tx);
      return x;
    });
    revalidatePath("/inventory/materials");
    return { message: `Material ${m.sku} added`, data: { id: m.id } };
  });
}

export async function updateMaterial(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("materials:edit");
    const d = materialSchema.parse(formToObject(fd));
    const old = await db.material.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!old) throw new UserError("Material not found.");
    const sku = d.sku || old.sku;
    if (sku !== old.sku) {
      const dup = await db.material.findFirst({ where: { companyId: c.companyId, sku, deletedAt: null, id: { not: id } } });
      if (dup) throw new UserError(`SKU ${sku} is already used by ${dup.name}.`);
    }
    await db.material.update({ where: { id }, data: { ...d, sku, vendorId: d.vendorId ?? null } });
    await audit(c, { action: "UPDATE", entityType: "Material", entityId: id, summary: `Updated material ${sku} – ${d.name}`, oldValue: { purchaseCost: num(old.purchaseCost) }, newValue: { purchaseCost: d.purchaseCost } });
    revalidatePath("/inventory/materials");
    return { message: "Material updated" };
  });
}

export async function deleteMaterial(id: string) {
  return run(async () => {
    const c = await assertPerm("materials:delete");
    const m = await db.material.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!m) throw new UserError("Material not found.");
    const used = (await db.inventoryTransaction.count({ where: { materialId: id } })) + (await db.purchaseOrderItem.count({ where: { materialId: id } })) + (await db.boqItem.count({ where: { materialId: id } }));
    if (used) throw new UserError("This material is used in stock movements, orders or BOQs, so it can't be deleted.");
    await db.material.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(c, { action: "DELETE", entityType: "Material", entityId: id, summary: `Deleted material ${m.sku} – ${m.name}` });
    revalidatePath("/inventory/materials");
    return { message: "Material deleted" };
  });
}

// ───────────────────────── PURCHASE REQUESTS ─────────────────────────
const prItem = z.object({
  materialId: z.string().optional().nullable(),
  description: zReqStr("Describe each item"),
  unit: z.string().trim().min(1).default("nos"),
  quantity: z.coerce.number({ message: "Enter a quantity" }).positive("Quantity must be above 0"),
  boqItemId: z.string().optional().nullable(),
});

const prSchema = z.object({
  projectId: zOptStr,
  requiredDate: zOptDate,
  reason: zOptStr,
  priority: z.nativeEnum(Priority).default("MEDIUM"),
});

function parseJson<T>(raw: unknown, schema: z.ZodType<T>, empty: string): T {
  let arr: unknown;
  try {
    arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new UserError("Items could not be read. Please reload the page.");
  }
  const p = schema.safeParse(arr);
  if (!p.success) throw new UserError(p.error.issues[0]?.message ?? empty);
  return p.data;
}

/** Estimated value of a request = qty × the material's last purchase cost (used to pick the approver). */
async function prValue(items: z.infer<typeof prItem>[]) {
  const ids = items.map((i) => i.materialId).filter(Boolean) as string[];
  const mats = ids.length ? await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, purchaseCost: true } }) : [];
  const cost = new Map(mats.map((m) => [m.id, num(m.purchaseCost)]));
  return items.reduce((s, i) => s + i.quantity * (i.materialId ? cost.get(i.materialId) ?? 0 : 0), 0);
}

async function checkProject(c: Ctx, projectId?: string) {
  if (!projectId) return;
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) }, select: { id: true } });
  if (!p) throw new UserError("Project not found or you don't have access to it.");
}

export async function createPurchaseRequest(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("purchase_requests:create");
    const raw = formToObject(fd);
    const d = prSchema.parse(raw);
    const items = parseJson(raw.items, z.array(prItem).min(1, "Add at least one item"), "Add at least one item");
    await checkProject(c, d.projectId);
    const pr = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, c.companyId, "PR");
      const x = await tx.purchaseRequest.create({
        data: { companyId: c.companyId, number, projectId: d.projectId ?? null, requestedById: c.userId, requiredDate: d.requiredDate, reason: d.reason, priority: d.priority, items: { create: items.map((i) => ({ materialId: i.materialId || null, description: i.description, unit: i.unit, quantity: i.quantity, boqItemId: i.boqItemId || null })) } },
      });
      await audit(c, { action: "CREATE", entityType: "PurchaseRequest", entityId: x.id, summary: `Created purchase request ${number} (${items.length} items)` }, tx);
      return x;
    });
    revalidatePath("/procurement/requests");
    return { message: `Request ${pr.number} saved`, data: { id: pr.id } };
  });
}

export async function updatePurchaseRequest(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("purchase_requests:edit");
    const raw = formToObject(fd);
    const d = prSchema.parse(raw);
    const items = parseJson(raw.items, z.array(prItem).min(1, "Add at least one item"), "Add at least one item");
    const pr = await db.purchaseRequest.findFirst({ where: { id, companyId: c.companyId } });
    if (!pr) throw new UserError("Request not found.");
    if (!["DRAFT", "REJECTED"].includes(pr.status)) throw new UserError("Only draft or rejected requests can be edited.");
    if (pr.requestedById !== c.userId && !c.can("purchase_requests:approve")) throw new UserError("You can only edit your own requests.");
    await checkProject(c, d.projectId);
    await db.$transaction(async (tx) => {
      await tx.purchaseRequestItem.deleteMany({ where: { requestId: id } });
      await tx.purchaseRequest.update({ where: { id }, data: { projectId: d.projectId ?? null, requiredDate: d.requiredDate, reason: d.reason, priority: d.priority, status: "DRAFT", items: { create: items.map((i) => ({ materialId: i.materialId || null, description: i.description, unit: i.unit, quantity: i.quantity, boqItemId: i.boqItemId || null })) } } });
      await audit(c, { action: "UPDATE", entityType: "PurchaseRequest", entityId: id, summary: `Updated purchase request ${pr.number}` }, tx);
    });
    revalidatePath("/procurement/requests");
    revalidatePath(`/procurement/requests/${id}`);
    return { message: "Request saved", data: { id } };
  });
}

export async function submitPurchaseRequest(id: string) {
  return run(async () => {
    const c = await assertPerm("purchase_requests:edit");
    const pr = await db.purchaseRequest.findFirst({ where: { id, companyId: c.companyId }, include: { items: true } });
    if (!pr) throw new UserError("Request not found.");
    if (!["DRAFT", "REJECTED"].includes(pr.status)) throw new UserError("This request has already been submitted.");
    if (!pr.items.length) throw new UserError("Add items first.");
    const value = await prValue(pr.items.map((i) => ({ materialId: i.materialId, description: i.description, unit: i.unit, quantity: num(i.quantity), boqItemId: i.boqItemId })));
    const r = await db.$transaction(async (tx) => {
      await tx.purchaseRequest.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      return requestApproval(tx, c, { type: "PURCHASE_REQUEST", entityType: "PurchaseRequest", entityId: id, title: `Purchase request ${pr.number}`, amount: value });
    });
    revalidatePath("/procurement/requests");
    revalidatePath(`/procurement/requests/${id}`);
    return { message: r.autoApproved ? "Approved (within your authority)" : "Sent for approval" };
  });
}

export async function deletePurchaseRequest(id: string) {
  return run(async () => {
    const c = await assertPerm("purchase_requests:edit");
    const pr = await db.purchaseRequest.findFirst({ where: { id, companyId: c.companyId } });
    if (!pr) throw new UserError("Request not found.");
    if (!["DRAFT", "REJECTED"].includes(pr.status)) throw new UserError("Only draft or rejected requests can be deleted.");
    if (pr.requestedById !== c.userId && !c.can("purchase_requests:delete")) throw new UserError("You can only delete your own requests.");
    await db.purchaseRequest.delete({ where: { id } });
    await audit(c, { action: "DELETE", entityType: "PurchaseRequest", entityId: id, summary: `Deleted purchase request ${pr.number}` });
    revalidatePath("/procurement/requests");
    return { message: "Request deleted" };
  });
}

// ───────────────────────── PURCHASE ORDERS ─────────────────────────
const poItem = z.object({
  materialId: z.string().optional().nullable(),
  description: zReqStr("Describe each item"),
  unit: z.string().trim().min(1).default("nos"),
  quantity: z.coerce.number({ message: "Enter a quantity" }).positive("Quantity must be above 0"),
  rate: z.coerce.number({ message: "Enter a rate" }).min(0, "Rate can't be negative"),
  taxPercent: z.coerce.number().min(0).max(100).default(18),
  boqItemId: z.string().optional().nullable(),
});

const poSchema = z.object({
  vendorId: zReqStr("Select a vendor"),
  projectId: zOptStr,
  requestId: zOptStr,
  deliveryDate: zOptDate,
  paymentTerms: zOptStr,
  notes: zOptStr,
  discountPct: zNumPos().max(100).default(0),
});

function poRows(items: z.infer<typeof poItem>[], discountPct: number) {
  const t = computeTotals(items.map((i) => ({ quantity: i.quantity, rate: i.rate, taxPercent: i.taxPercent })), { pct: discountPct });
  return { t, rows: items.map((i, idx) => ({ materialId: i.materialId || null, description: i.description, unit: i.unit, quantity: i.quantity, rate: i.rate, taxPercent: i.taxPercent, amount: t.lines[idx].amount, boqItemId: i.boqItemId || null })) };
}

export async function createPurchaseOrder(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("purchase_orders:create");
    const raw = formToObject(fd);
    const d = poSchema.parse(raw);
    const items = parseJson(raw.items, z.array(poItem).min(1, "Add at least one item"), "Add at least one item");
    const vendor = await db.vendor.findFirst({ where: { id: d.vendorId, companyId: c.companyId, deletedAt: null } });
    if (!vendor) throw new UserError("Vendor not found.");
    await checkProject(c, d.projectId);
    if (d.requestId) {
      const pr = await db.purchaseRequest.findFirst({ where: { id: d.requestId, companyId: c.companyId } });
      if (!pr || pr.status !== "APPROVED") throw new UserError("Only approved purchase requests can be converted into an order.");
    }
    const { t, rows } = poRows(items, d.discountPct);
    const po = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, c.companyId, "po");
      const x = await tx.purchaseOrder.create({
        data: { companyId: c.companyId, number, vendorId: d.vendorId, projectId: d.projectId ?? null, requestId: d.requestId ?? null, deliveryDate: d.deliveryDate, paymentTerms: d.paymentTerms, notes: d.notes, createdById: c.userId, subtotal: t.subtotal, discountAmount: t.discount, taxAmount: t.tax, total: t.total, items: { create: rows } },
      });
      if (d.requestId) await tx.purchaseRequest.update({ where: { id: d.requestId }, data: { status: "ORDERED" } });
      await audit(c, { action: "CREATE", entityType: "PurchaseOrder", entityId: x.id, summary: `Created ${number} for ${vendor.name} – ₹${t.total.toLocaleString("en-IN")}` }, tx);
      return x;
    });
    revalidatePath("/procurement/orders");
    revalidatePath("/procurement/requests");
    return { message: `${po.number} saved`, data: { id: po.id } };
  });
}

export async function updatePurchaseOrder(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("purchase_orders:edit");
    const raw = formToObject(fd);
    const d = poSchema.parse(raw);
    const items = parseJson(raw.items, z.array(poItem).min(1, "Add at least one item"), "Add at least one item");
    const po = await db.purchaseOrder.findFirst({ where: { id, companyId: c.companyId } });
    if (!po) throw new UserError("Purchase order not found.");
    if (po.status !== "DRAFT") throw new UserError("Only draft purchase orders can be edited. Approved orders are locked.");
    await checkProject(c, d.projectId);
    const { t, rows } = poRows(items, d.discountPct);
    await db.$transaction(async (tx) => {
      await tx.purchaseOrderItem.deleteMany({ where: { poId: id } });
      await tx.purchaseOrder.update({ where: { id }, data: { vendorId: d.vendorId, projectId: d.projectId ?? null, deliveryDate: d.deliveryDate, paymentTerms: d.paymentTerms, notes: d.notes, subtotal: t.subtotal, discountAmount: t.discount, taxAmount: t.tax, total: t.total, items: { create: rows } } });
      await audit(c, { action: "UPDATE", entityType: "PurchaseOrder", entityId: id, summary: num(po.total) !== t.total ? `${c.name} changed ${po.number} from ₹${num(po.total).toLocaleString("en-IN")} to ₹${t.total.toLocaleString("en-IN")}` : `Updated ${po.number}`, oldValue: { total: num(po.total) }, newValue: { total: t.total } }, tx);
    });
    revalidatePath("/procurement/orders");
    revalidatePath(`/procurement/orders/${id}`);
    return { message: "Purchase order saved", data: { id } };
  });
}

export async function submitPurchaseOrder(id: string) {
  return run(async () => {
    const c = await assertPerm("purchase_orders:edit");
    const po = await db.purchaseOrder.findFirst({ where: { id, companyId: c.companyId }, include: { items: true, vendor: true } });
    if (!po) throw new UserError("Purchase order not found.");
    if (po.status !== "DRAFT") throw new UserError("Only draft orders can be submitted.");
    if (!po.items.length || num(po.total) <= 0) throw new UserError("Add items with a value first.");
    const r = await db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      return requestApproval(tx, c, { type: "PURCHASE_ORDER", entityType: "PurchaseOrder", entityId: id, title: `${po.number} – ${po.vendor.name}`, amount: num(po.total) });
    });
    revalidatePath("/procurement/orders");
    revalidatePath(`/procurement/orders/${id}`);
    return { message: r.autoApproved ? "Approved (within your authority)" : "Sent for approval" };
  });
}

export async function sendPurchaseOrder(id: string) {
  return run(async () => {
    const c = await assertPerm("purchase_orders:edit");
    const po = await db.purchaseOrder.findFirst({ where: { id, companyId: c.companyId }, include: { vendor: true } });
    if (!po) throw new UserError("Purchase order not found.");
    if (po.status !== "APPROVED") throw new UserError("Only approved orders can be sent to the vendor.");
    await db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { status: "SENT_TO_VENDOR" } });
      await audit(c, { action: "UPDATE", entityType: "PurchaseOrder", entityId: id, summary: `${po.number} sent to ${po.vendor.name}` }, tx);
    });
    revalidatePath("/procurement/orders");
    revalidatePath(`/procurement/orders/${id}`);
    return { message: `Marked as sent to ${po.vendor.name}` };
  });
}

export async function cancelPurchaseOrder(id: string, fd?: FormData) {
  return run(async () => {
    const c = await assertPerm("purchase_orders:edit");
    const po = await db.purchaseOrder.findFirst({ where: { id, companyId: c.companyId } });
    if (!po) throw new UserError("Purchase order not found.");
    if (["RECEIVED", "CLOSED", "CANCELLED", "PARTIALLY_RECEIVED"].includes(po.status)) throw new UserError("Orders with received material can't be cancelled. Close them instead.");
    const received = await db.materialReceipt.count({ where: { poId: id } });
    if (received) throw new UserError("Material has already been received against this order.");
    const reason = fd ? String(fd.get("reason") ?? "").trim() : "";
    await db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED", notes: reason ? `${po.notes ? po.notes + "\n" : ""}Cancelled: ${reason}` : po.notes } });
      await tx.approval.updateMany({ where: { entityType: "PurchaseOrder", entityId: id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), remarks: "Order cancelled" } });
      if (po.requestId) await tx.purchaseRequest.update({ where: { id: po.requestId }, data: { status: "APPROVED" } });
      await audit(c, { action: "UPDATE", entityType: "PurchaseOrder", entityId: id, summary: `Cancelled ${po.number}${reason ? ` – ${reason}` : ""}` }, tx);
    });
    revalidatePath("/procurement/orders");
    revalidatePath(`/procurement/orders/${id}`);
    return { message: "Order cancelled" };
  });
}

export async function closePurchaseOrder(id: string) {
  return run(async () => {
    const c = await assertPerm("purchase_orders:edit");
    const po = await db.purchaseOrder.findFirst({ where: { id, companyId: c.companyId } });
    if (!po) throw new UserError("Purchase order not found.");
    if (!["RECEIVED", "PARTIALLY_RECEIVED"].includes(po.status)) throw new UserError("Only orders with received material can be closed.");
    await db.purchaseOrder.update({ where: { id }, data: { status: "CLOSED" } });
    await audit(c, { action: "UPDATE", entityType: "PurchaseOrder", entityId: id, summary: `Closed ${po.number}${po.status === "PARTIALLY_RECEIVED" ? " (short-closed)" : ""}` });
    revalidatePath("/procurement/orders");
    revalidatePath(`/procurement/orders/${id}`);
    return { message: "Order closed" };
  });
}
