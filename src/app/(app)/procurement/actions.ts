"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BoqCategory, Priority, type Prisma } from "@prisma/client";
import { putFile, deleteFile, validateUpload, UploadError } from "@/lib/storage";
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
import { daysNotice, isShortNotice } from "@/lib/material-notice";
import { notifyRoles, notifyUsers } from "@/lib/notify";

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ VENDORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  tier: z.enum(["PRIMARY", "BACKUP", "EMERGENCY"]).default("PRIMARY"),
  trades: zOptStr,
  crewSize: z.coerce.number().int().min(1, "Crew size is at least 1").max(1000).optional(),
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
      await audit(c, { action: "CREATE", entityType: "Vendor", entityId: x.id, summary: `Created vendor ${code} â€“ ${d.name}` }, tx);
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
    await audit(c, { action: "UPDATE", entityType: "Vendor", entityId: id, summary: `Updated vendor ${old.code} â€“ ${old.name}`, oldValue: { name: old.name, gstin: old.gstin, phone: old.phone } , newValue: { name: d.name, gstin: d.gstin, phone: d.phone } });
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
    if (used) throw new UserError("This vendor has purchase orders or bills. Their history is kept â€“ it can't be deleted.");
    await db.vendor.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(c, { action: "DELETE", entityType: "Vendor", entityId: id, summary: `Deleted vendor ${v.code} â€“ ${v.name}` });
    revalidatePath("/procurement/vendors");
    return { message: "Vendor deleted" };
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ MATERIALS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      await audit(c, { action: "CREATE", entityType: "Material", entityId: x.id, summary: `Added material ${sku} â€“ ${d.name}` }, tx);
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
    await audit(c, { action: "UPDATE", entityType: "Material", entityId: id, summary: `Updated material ${sku} â€“ ${d.name}`, oldValue: { purchaseCost: num(old.purchaseCost) }, newValue: { purchaseCost: d.purchaseCost } });
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
    await audit(c, { action: "DELETE", entityType: "Material", entityId: id, summary: `Deleted material ${m.sku} â€“ ${m.name}` });
    revalidatePath("/inventory/materials");
    return { message: "Material deleted" };
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PURCHASE REQUESTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const prItem = z.object({
  materialId: z.string().optional().nullable(),
  description: zReqStr("Describe each item"),
  unit: z.string().trim().min(1, "Write the unit for each item").max(30).default("nos"),
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

/** Estimated value of a request = qty Ã— the material's last purchase cost (used to pick the approver). */
async function prValue(items: z.infer<typeof prItem>[]) {
  const ids = items.map((i) => i.materialId).filter(Boolean) as string[];
  const mats = ids.length ? await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, purchaseCost: true } }) : [];
  const cost = new Map(mats.map((m) => [m.id, num(m.purchaseCost)]));
  return items.reduce((s, i) => s + i.quantity * (i.materialId ? cost.get(i.materialId) ?? 0 : 0), 0);
}

/** Company rule: material is requested at least this many days before it is needed. */
async function minNotice(companyId: string) {
  return (await db.companySettings.findUnique({ where: { companyId }, select: { materialNoticeDays: true } }))?.materialNoticeDays ?? 2;
}

async function checkProject(c: Ctx, projectId?: string) {
  if (!projectId) return;
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) }, select: { id: true } });
  if (!p) throw new UserError("Project not found or you don't have access to it.");
}

/** "Send for approval" on the form saves AND submits in one press; if it cannot be sent yet, it stays a draft and says why. */
async function sendNow(fd: FormData, id: string, label: string) {
  if (fd.get("submitNow") !== "1") return { message: `${label} saved as a draft. Press Submit when it is ready.`, data: { id } };
  const r = await submitPurchaseRequest(id);
  return r.ok ? { message: `${label} sent for approval`, data: { id } } : { message: `${label} saved as a draft, NOT sent yet: ${r.error}`, data: { id } };
}

const AUDIO_EXT = ["webm", "ogg", "m4a", "mp4"];

/** The voice notes recorded on a request (up to 5): checked and stored first, attached to the request in the same save. */
async function storeVoice(c: Ctx, fd: FormData) {
  const files = fd.getAll("voice").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 5) throw new UserError("Add at most 5 voice notes.");
  const checked = [];
  for (const f of files) {
    if (!AUDIO_EXT.includes(f.name.split(".").pop()?.toLowerCase() ?? "")) throw new UserError("A voice note could not be read. Record it again.");
    try { checked.push(await validateUpload(f)); } catch (e) { if (e instanceof UploadError) throw new UserError(e.message); throw e; }
  }
  const stored = [];
  for (const v of checked) stored.push({ key: await putFile(c.companyId, v.bytes, v.ext), ...v });
  return stored;
}
type StoredVoice = Awaited<ReturnType<typeof storeVoice>>;
const attachVoice = async (tx: Prisma.TransactionClient, c: Ctx, voices: StoredVoice, prId: string, number: string) => {
  const before = await tx.document.count({ where: { entityType: "PURCHASE_REQUEST", entityId: prId } });
  for (const [i, v] of voices.entries()) {
    await tx.document.create({ data: { companyId: c.companyId, name: `${number} voice note ${before + i + 1}.${v.ext}`, type: "OTHER", entityType: "PURCHASE_REQUEST", entityId: prId, storageKey: v.key, mimeType: v.mime, size: v.size, uploadedById: c.userId } });
  }
};

export async function createPurchaseRequest(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("purchase_requests:create");
    const raw = formToObject(fd);
    const d = prSchema.parse(raw);
    const items = parseJson(raw.items, z.array(prItem).min(1, "Add at least one item"), "Add at least one item");
    await checkProject(c, d.projectId);
    const shortNotice = isShortNotice(d.requiredDate, await minNotice(c.companyId));
    const voice = await storeVoice(c, fd);
    try {
      const pr = await db.$transaction(async (tx) => {
        const number = await nextNumber(tx, c.companyId, "PR");
        const x = await tx.purchaseRequest.create({
          data: { companyId: c.companyId, number, projectId: d.projectId ?? null, requestedById: c.userId, requiredDate: d.requiredDate, reason: d.reason, priority: d.priority, shortNotice, items: { create: items.map((i) => ({ materialId: i.materialId || null, description: i.description, unit: i.unit, quantity: i.quantity, boqItemId: i.boqItemId || null })) } },
        });
        await attachVoice(tx, c, voice, x.id, number);
        await audit(c, { action: "CREATE", entityType: "PurchaseRequest", entityId: x.id, summary: `Created purchase request ${number} (${items.length} items)` }, tx);
        return x;
      });
      revalidatePath("/procurement/requests");
      return sendNow(fd, pr.id, `Request ${pr.number}`);
    } catch (e) {
      for (const v of voice) await deleteFile(v.key); // no orphan file if saving failed
      throw e;
    }
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
    const shortNotice = isShortNotice(d.requiredDate, await minNotice(c.companyId));
    const voice = await storeVoice(c, fd);
    try {
      await db.$transaction(async (tx) => {
        await tx.purchaseRequestItem.deleteMany({ where: { requestId: id } });
        await tx.purchaseRequest.update({ where: { id }, data: { projectId: d.projectId ?? null, requiredDate: d.requiredDate, reason: d.reason, priority: d.priority, shortNotice, status: "DRAFT", items: { create: items.map((i) => ({ materialId: i.materialId || null, description: i.description, unit: i.unit, quantity: i.quantity, boqItemId: i.boqItemId || null })) } } });
        await attachVoice(tx, c, voice, id, pr.number);
        await audit(c, { action: "UPDATE", entityType: "PurchaseRequest", entityId: id, summary: `Updated purchase request ${pr.number}` }, tx);
      });
    } catch (e) {
      for (const v of voice) await deleteFile(v.key);
      throw e;
    }
    revalidatePath("/procurement/requests");
    revalidatePath(`/procurement/requests/${id}`);
    return sendNow(fd, id, "Request");
  });
}

export async function submitPurchaseRequest(id: string) {
  return run(async () => {
    const c = await assertPerm("purchase_requests:edit");
    const pr = await db.purchaseRequest.findFirst({ where: { id, companyId: c.companyId }, include: { items: true } });
    if (!pr) throw new UserError("Request not found.");
    if (!["DRAFT", "REJECTED"].includes(pr.status)) throw new UserError("This request has already been submitted.");
    if (!pr.items.length) throw new UserError("Add items first.");
    // SOP: ask at least 2-3 days ahead. Late requests are allowed, but only with a reason, and they are flagged to the PM and procurement.
    const minDays = await minNotice(c.companyId);
    const late = isShortNotice(pr.requiredDate, minDays);
    if (late && !pr.reason?.trim()) {
      const left = daysNotice(pr.requiredDate!);
      throw new UserError(`This material is needed ${left <= 0 ? "today or earlier" : `in ${left} day${left === 1 ? "" : "s"}`}, but requests must be raised at least ${minDays} days ahead. Write the reason it is late in the Reason box, then submit again.`);
    }
    const value = await prValue(pr.items.map((i) => ({ materialId: i.materialId, description: i.description, unit: i.unit, quantity: num(i.quantity), boqItemId: i.boqItemId })));
    const r = await db.$transaction(async (tx) => {
      await tx.purchaseRequest.update({ where: { id }, data: { status: "PENDING_APPROVAL", shortNotice: late, ...(late && (pr.priority === "LOW" || pr.priority === "MEDIUM") ? { priority: "HIGH" } : {}) } });
      if (late) {
        const pm = pr.projectId ? (await tx.project.findUnique({ where: { id: pr.projectId }, select: { projectManagerId: true } }))?.projectManagerId : null;
        const t = { companyId: c.companyId, type: "GENERAL" as const, title: `Short-notice material request ${pr.number}`, body: `Needed by ${pr.requiredDate!.toISOString().slice(0, 10)}. Reason: ${pr.reason}`, link: `/procurement/requests/${id}` };
        if (pm && pm !== c.userId) await notifyUsers([pm], t, tx);
        await notifyRoles(c.companyId, ["PROCUREMENT"], t, tx);
      }
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PURCHASE ORDERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      await audit(c, { action: "CREATE", entityType: "PurchaseOrder", entityId: x.id, summary: `Created ${number} for ${vendor.name} â€“ â‚¹${t.total.toLocaleString("en-IN")}` }, tx);
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
      await audit(c, { action: "UPDATE", entityType: "PurchaseOrder", entityId: id, summary: num(po.total) !== t.total ? `${c.name} changed ${po.number} from â‚¹${num(po.total).toLocaleString("en-IN")} to â‚¹${t.total.toLocaleString("en-IN")}` : `Updated ${po.number}`, oldValue: { total: num(po.total) }, newValue: { total: t.total } }, tx);
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
      return requestApproval(tx, c, { type: "PURCHASE_ORDER", entityType: "PurchaseOrder", entityId: id, title: `${po.number} â€“ ${po.vendor.name}`, amount: num(po.total) });
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
      await audit(c, { action: "UPDATE", entityType: "PurchaseOrder", entityId: id, summary: `Cancelled ${po.number}${reason ? ` â€“ ${reason}` : ""}` }, tx);
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
