"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { projectScope } from "@/lib/scope";
import { move, siteLocation } from "@/lib/inventory";
import { raiseAction, dueIn } from "@/lib/action-items";
import { formToObject, zDate, zOptStr, zReqStr } from "@/lib/form";
import { calendarDay, num, round2 } from "@/lib/utils";

const schema = z.object({
  materialId: zReqStr("Choose the material"),
  projectId: zOptStr,
  locationId: zOptStr,
  kind: z.enum(["WASTE", "DAMAGED", "SUPPLIER_DAMAGE", "REWORK", "OFFCUT_REUSABLE"]),
  quantity: z.coerce.number({ message: "How much?" }).positive("Quantity must be above 0"),
  reason: zReqStr("Say why (a wrong cut, damaged in transport, drawing changed …)"),
  ownerId: zOptStr,
  actionNote: zOptStr,
  date: zDate("Pick the day"),
});

/**
 * Record material lost or set aside. Waste, damaged, supplier-damaged and rework quantities leave the stock (refused if the
 * location does not have that much); a reusable offcut stays in stock and is only recorded, so it is never called waste.
 * Anything except an offcut needs somebody named to look into why, and that person gets an action.
 */
export async function recordWaste(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("inventory:create");
    const d = schema.parse(formToObject(fd));
    if (d.date.getTime() > calendarDay().getTime()) throw new UserError("You can't record a day that has not happened yet.");
    const mat = await db.material.findFirst({ where: { id: d.materialId, companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true, purchaseCost: true } });
    if (!mat) throw new UserError("Material not found.");
    const project = d.projectId ? await db.project.findFirst({ where: { id: d.projectId, ...projectScope(c) }, select: { id: true, code: true, projectManagerId: true } }) : null;
    if (d.projectId && !project) throw new UserError("Project not found or you don't have access to it.");
    const takesStock = d.kind !== "OFFCUT_REUSABLE";
    if (takesStock && !d.ownerId) throw new UserError("Name the person who will find out why this was lost. (A reusable offcut needs no one.)");
    if (d.ownerId && !(await db.user.findFirst({ where: { id: d.ownerId, companyId: c.companyId, isActive: true, deletedAt: null, role: { notIn: ["CLIENT", "VENDOR", "WORKER"] } }, select: { id: true } }))) throw new UserError("Choose someone from your team.");

    const rec = await db.$transaction(async (tx) => {
      let unitCost = num(mat.purchaseCost);
      let locationId = d.locationId ?? null;
      if (takesStock) {
        locationId = locationId ?? (project ? await siteLocation(tx, c.companyId, project.id) : null);
        if (!locationId) throw new UserError("Choose the location the material was lost from.");
        const r = await move(tx, c, { type: "DAMAGED", materialId: mat.id, quantity: d.quantity, fromLocationId: locationId, projectId: project?.id ?? null, refType: "WASTE", note: `${d.kind.toLowerCase().replace("_", " ")}: ${d.reason}` });
        unitCost = r.unitCost || unitCost;
      }
      const w = await tx.materialWaste.create({
        data: { companyId: c.companyId, projectId: project?.id ?? null, materialId: mat.id, locationId, kind: d.kind, quantity: d.quantity, unit: mat.unit, unitCost, costValue: round2(d.quantity * unitCost), reason: d.reason, ownerId: d.ownerId ?? null, actionNote: d.actionNote ?? null, date: d.date, recordedById: c.userId },
      });
      if (takesStock && d.ownerId) {
        await raiseAction(tx, { companyId: c.companyId, title: `Find out why: ${d.quantity} ${mat.unit} ${mat.name} lost${project ? ` at ${project.code}` : ""}`, severity: "LOW", ownerId: d.ownerId, createdById: c.userId, projectId: project?.id ?? null, dueDate: dueIn("LOW"), detail: `${d.reason}${d.actionNote ? ` · ${d.actionNote}` : ""}. Value ₹${w.costValue.toString()}.`, sourceType: "MaterialWaste", sourceId: w.id, sourceLabel: "waste record", link: "/inventory/waste" });
      }
      await audit(c, { action: "CREATE", entityType: "MaterialWaste", entityId: w.id, summary: `${c.name} recorded ${d.quantity} ${mat.unit} of ${mat.name} as ${d.kind.toLowerCase().replace("_", " ")}${project ? ` at ${project.code}` : ""}: ${d.reason}` }, tx);
      return w;
    });
    revalidatePath("/inventory/waste");
    revalidatePath("/inventory/stock");
    return { message: takesStock ? `Recorded: ${d.quantity} ${mat.unit} taken out of stock (₹${rec.costValue.toString()})` : "Recorded as a reusable offcut (still in stock)" };
  });
}
