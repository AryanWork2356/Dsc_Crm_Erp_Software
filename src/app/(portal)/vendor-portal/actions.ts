"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCtx, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { notifyRoles } from "@/lib/notify";
import { formToObject, zOptDate, zOptStr, zReqStr } from "@/lib/form";

/** Vendor actions only ever touch the signed-in vendor's own purchase orders. */
async function vendorCtx(): Promise<Ctx & { vendorId: string }> {
  const c = await getCtx();
  if (!c || c.role !== "VENDOR" || !c.vendorId) throw new UserError("Please sign in with your vendor account.");
  return c as Ctx & { vendorId: string };
}

export async function acknowledgeOrder(poId: string, fd: FormData) {
  return run(async () => {
    const c = await vendorCtx();
    const d = z.object({ expectedDate: zOptDate, note: zOptStr }).parse(formToObject(fd));
    const po = await db.purchaseOrder.findFirst({ where: { id: poId, companyId: c.companyId, vendorId: c.vendorId, status: { in: ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] } } });
    if (!po) throw new UserError("This order isn't open for updates.");
    const line = `Vendor update ${new Date().toLocaleDateString("en-IN")}: ${d.expectedDate ? `dispatch/delivery expected ${d.expectedDate.toLocaleDateString("en-IN")}. ` : ""}${d.note ?? ""}`.trim();
    await db.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id: poId }, data: { notes: `${po.notes ? po.notes + "\n" : ""}${line}`, ...(d.expectedDate ? { deliveryDate: d.expectedDate } : {}) } });
      await audit(c, { action: "UPDATE", entityType: "PurchaseOrder", entityId: poId, summary: `Vendor ${c.name} updated ${po.number}${d.expectedDate ? `: delivery ${d.expectedDate.toISOString().slice(0, 10)}` : ""}`, oldValue: { deliveryDate: po.deliveryDate }, newValue: { deliveryDate: d.expectedDate ?? po.deliveryDate } }, tx);
      await notifyRoles(c.companyId, ["PROCUREMENT"], { type: "PO_PENDING", title: `Vendor update on ${po.number}`, body: line, link: `/procurement/orders/${poId}` }, tx);
    });
    revalidatePath("/vendor-portal");
    return { message: "Thanks – our procurement team has been notified." };
  });
}

export async function messageProcurement(fd: FormData) {
  return run(async () => {
    const c = await vendorCtx();
    const d = z.object({ message: zReqStr("Write your message"), poId: zOptStr }).parse(formToObject(fd));
    const po = d.poId ? await db.purchaseOrder.findFirst({ where: { id: d.poId, companyId: c.companyId, vendorId: c.vendorId } }) : null;
    await notifyRoles(c.companyId, ["PROCUREMENT", "ACCOUNTS"], { type: "GENERAL", title: `Message from vendor ${c.name}${po ? ` about ${po.number}` : ""}`, body: d.message.slice(0, 300), link: po ? `/procurement/orders/${po.id}` : "/procurement/vendors" });
    await audit(c, { action: "CREATE", entityType: "VendorMessage", summary: `Vendor ${c.name} sent a message${po ? ` about ${po.number}` : ""}` });
    return { message: "Message sent" };
  });
}
