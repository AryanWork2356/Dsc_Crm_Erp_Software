"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { projectScope } from "@/lib/scope";
import { riskOf, syncDeliveryRisks } from "@/lib/delivery-risk";
import { formToObject, zOptDate, zOptStr } from "@/lib/form";
import { startOfDay } from "@/lib/utils";

const schema = z.object({
  promisedEta: zOptDate,
  needBy: zOptDate,
  delayReason: z.enum(["DSC_LATE_REQUEST", "SUPPLIER_DELAY", "TRANSPORT", "SPEC_CHANGE", "SITE_ACCESS", "OTHER", "UNKNOWN"]).optional(),
  recoveryNote: zOptStr,
});

/**
 * Procurement records the supplier's latest promised date (and the date the site needs it). When the line is late or will arrive
 * too late, the reason and a recovery plan are required: that is how a delay becomes a fixed problem instead of a surprise.
 */
export async function updateDeliveryLine(itemId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("purchase_orders:edit");
    const d = schema.parse(formToObject(fd));
    const item = await db.purchaseOrderItem.findFirst({ where: { id: itemId, po: { companyId: c.companyId } }, include: { po: { select: { id: true, number: true, projectId: true, deliveryDate: true } } } });
    if (!item) throw new UserError("Order line not found.");
    if (item.po.projectId && !(await db.project.findFirst({ where: { id: item.po.projectId, ...projectScope(c) }, select: { id: true } })) && !["OWNER", "MANAGEMENT", "ADMIN", "PROCUREMENT"].includes(c.role)) throw new UserError("You aren't on that project.");
    const eta = d.promisedEta ?? item.promisedEta ?? item.po.deliveryDate;
    const needBy = d.needBy ?? item.needBy ?? item.po.deliveryDate;
    const risk = riskOf(needBy, eta, startOfDay());
    if (risk.status !== "OK") {
      if (!d.delayReason) throw new UserError("This delivery is late or will arrive after the site needs it. Say why (supplier, our own late request, transport …).");
      if ((d.recoveryNote ?? "").trim().length < 3) throw new UserError("Write what will be done to recover (another supplier, part delivery, move the work …).");
    }
    await db.purchaseOrderItem.update({ where: { id: itemId }, data: { promisedEta: d.promisedEta ?? item.promisedEta, needBy: d.needBy ?? item.needBy, delayReason: d.delayReason ?? (risk.status === "OK" ? null : item.delayReason), recoveryNote: d.recoveryNote ?? (risk.status === "OK" ? null : item.recoveryNote) } });
    await audit(c, { action: "UPDATE", entityType: "PurchaseOrderItem", entityId: itemId, summary: `${c.name} updated delivery of a line on ${item.po.number}: promised ${eta?.toISOString().slice(0, 10) ?? "no date"}, needed ${needBy?.toISOString().slice(0, 10) ?? "no date"}${d.delayReason ? `, reason ${d.delayReason}` : ""}` });
    await syncDeliveryRisks(c.companyId);
    revalidatePath("/procurement/deliveries");
    return { message: risk.status === "OK" ? "Saved: delivery is on time" : "Saved: the reason and plan are recorded and the action stays open until it arrives" };
  });
}
