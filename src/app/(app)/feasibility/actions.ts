"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { projectScope } from "@/lib/scope";
import { raiseAction } from "@/lib/action-items";
import { isOpen } from "@/lib/readiness";
import { formToObject, zDate, zOptDate, zOptStr, zReqStr } from "@/lib/form";

/** The checklist belongs to a project (people on it may edit) or to a quotation (anyone who can see the quotation). */
async function mayTouch(c: Ctx, f: { projectId: string | null; quotationId: string | null; companyId: string }) {
  if (f.companyId !== c.companyId) throw new UserError("Not found.");
  if (f.projectId) {
    if (!(await db.project.findFirst({ where: { id: f.projectId, ...projectScope(c) }, select: { id: true } }))) throw new UserError("Project not found or you don't have access to it.");
  } else if (f.quotationId) {
    if (!c.can("quotations:view")) throw new UserError("You can't open this quotation.");
    if (!(await db.quotation.findFirst({ where: { id: f.quotationId, companyId: c.companyId, deletedAt: null }, select: { id: true } }))) throw new UserError("Quotation not found.");
  }
}

const itemSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "AT_RISK", "NOT_NEEDED"]),
  ownerId: zOptStr,
  dueDate: zOptDate,
  evidence: zOptStr,
});

/** Mark one question confirmed / at risk / not needed. Confirming or waiving needs a note: who confirmed it and how. */
export async function updateChecklistItem(itemId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("feasibility:edit");
    const d = itemSchema.parse(formToObject(fd));
    const item = await db.checklistItem.findUnique({ where: { id: itemId }, include: { feasibility: true } });
    if (!item) throw new UserError("Item not found.");
    await mayTouch(c, item.feasibility);
    if ((d.status === "CONFIRMED" || d.status === "NOT_NEEDED") && (d.evidence ?? "").trim().length < 3) {
      throw new UserError(d.status === "CONFIRMED" ? "Say who or what confirmed it (a person and when, or a document). Typing a name in a box is not a confirmation." : "Say why it is not needed.");
    }
    if (d.ownerId && !(await db.user.findFirst({ where: { id: d.ownerId, companyId: c.companyId, isActive: true, deletedAt: null, role: { notIn: ["CLIENT", "VENDOR", "WORKER"] } }, select: { id: true } }))) throw new UserError("Choose someone from your team as the owner.");
    const done = d.status === "CONFIRMED" || d.status === "NOT_NEEDED";
    await db.checklistItem.update({ where: { id: itemId }, data: { status: d.status, ownerId: d.ownerId ?? null, dueDate: d.dueDate ?? item.dueDate, evidence: d.evidence ?? item.evidence, confirmedAt: done ? new Date() : null, confirmedById: done ? c.userId : null } });
    await audit(c, { action: "UPDATE", entityType: "ChecklistItem", entityId: itemId, summary: `${c.name} set “${item.label}” to ${d.status.toLowerCase().replace("_", " ")}${d.evidence ? `: ${d.evidence}` : ""}` });
    revalidatePath(`/feasibility`, "layout");
    return { message: "Saved" };
  });
}

const decisionSchema = z.object({
  decision: z.enum(["ACCEPT", "ACCEPT_WITH_CONDITIONS", "RENEGOTIATE_OR_DECLINE"]),
  note: zOptStr,
  exceptionNote: zOptStr,
  resolveBy: zOptDate,
});

/**
 * The decision. Accepting while questions are still open is an allowed EXCEPTION, but it must say why, name the approver (the
 * person deciding) and give a date by which the gaps close; an action is raised for each open item.
 */
export async function decideFeasibility(feasibilityId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("feasibility:approve");
    const d = decisionSchema.parse(formToObject(fd));
    const f = await db.feasibility.findUnique({ where: { id: feasibilityId }, include: { items: true } });
    if (!f) throw new UserError("Not found.");
    await mayTouch(c, f);
    const open = f.items.filter((i) => i.kind === "FEASIBILITY" && isOpen(i));
    if (d.decision === "RENEGOTIATE_OR_DECLINE" && !(d.note ?? "").trim()) throw new UserError("Say what must change, or why DSC is declining.");
    if (d.decision === "ACCEPT_WITH_CONDITIONS" && !(d.note ?? "").trim()) throw new UserError("Write the conditions that must be met.");
    if (d.decision !== "RENEGOTIATE_OR_DECLINE" && open.length > 0) {
      if ((d.exceptionNote ?? "").trim().length < 5) throw new UserError(`${open.length} question(s) are still open (${open.map((i) => i.label).join(", ")}). To go ahead anyway, write why and who is accepting the risk.`);
      if (!d.resolveBy) throw new UserError("Give the date by which the open questions must be closed.");
      if (d.resolveBy.getTime() < Date.now() - 86400000) throw new UserError("That date has already passed.");
    }
    await db.$transaction(async (tx) => {
      await tx.feasibility.update({
        where: { id: feasibilityId },
        data: { decision: d.decision, decidedById: c.userId, decidedAt: new Date(), note: d.note ?? null, exceptionNote: d.decision !== "RENEGOTIATE_OR_DECLINE" && open.length ? d.exceptionNote ?? null : null, exceptionApproverId: d.decision !== "RENEGOTIATE_OR_DECLINE" && open.length ? c.userId : null, resolveBy: d.decision !== "RENEGOTIATE_OR_DECLINE" && open.length ? d.resolveBy ?? null : null },
      });
      if (d.decision !== "RENEGOTIATE_OR_DECLINE" && open.length && d.resolveBy) {
        const pm = f.projectId ? (await tx.project.findUnique({ where: { id: f.projectId }, select: { projectManagerId: true } }))?.projectManagerId : null;
        for (const i of open) {
          await raiseAction(tx, { companyId: c.companyId, title: `Close before ${d.resolveBy.toLocaleDateString("en-IN")}: ${i.label} not confirmed`, severity: "HIGH", ownerId: i.ownerId ?? pm ?? c.userId, createdById: c.userId, projectId: f.projectId, dueDate: d.resolveBy, detail: `${i.question ?? ""} Accepted as an exception by ${c.name}: ${d.exceptionNote}`, sourceType: "ChecklistItem", sourceId: i.id, sourceLabel: `feasibility: ${i.label}`, link: f.projectId ? `/feasibility/project/${f.projectId}` : `/feasibility/quotation/${f.quotationId}` });
        }
      }
      await audit(c, { action: "APPROVE", entityType: "Feasibility", entityId: feasibilityId, summary: `${c.name} decided: ${d.decision.replaceAll("_", " ").toLowerCase()}${open.length && d.decision !== "RENEGOTIATE_OR_DECLINE" ? ` as an exception with ${open.length} open question(s)` : ""}` }, tx);
    });
    revalidatePath(`/feasibility`, "layout");
    return { message: "Decision recorded" };
  });
}

const dueSchema = z.object({ dueDate: zDate("Pick the date"), ownerId: zReqStr("Choose the owner") });
/** Set who owns a checklist item and when it is due, for several items at once is not needed: one by one keeps ownership clear. */
export async function assignChecklistItem(itemId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("feasibility:edit");
    const d = dueSchema.parse(formToObject(fd));
    const item = await db.checklistItem.findUnique({ where: { id: itemId }, include: { feasibility: true } });
    if (!item) throw new UserError("Item not found.");
    await mayTouch(c, item.feasibility);
    await db.checklistItem.update({ where: { id: itemId }, data: { ownerId: d.ownerId, dueDate: d.dueDate } });
    revalidatePath(`/feasibility`, "layout");
    return { message: "Assigned" };
  });
}
