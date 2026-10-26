"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { projectScope } from "@/lib/scope";
import { raiseAction, resolveActionsFor } from "@/lib/action-items";
import { coordinatorFor, shortDaySeverity, syncResourceShortages } from "@/lib/resources";
import { notifyUsers } from "@/lib/notify";
import { calendarDay } from "@/lib/utils";
import { formToObject, zDate, zOptStr, zReqStr } from "@/lib/form";

async function myProject(c: Ctx, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) }, select: { id: true, code: true, name: true, projectManagerId: true } });
  if (!p) throw new UserError("Project not found or you don't have access to it.");
  return p;
}
async function checkVendor(c: Ctx, id?: string) {
  if (!id) return;
  if (!(await db.vendor.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, select: { id: true } }))) throw new UserError("Vendor not found.");
}

const needSchema = z.object({
  projectId: zReqStr("Choose the project"),
  trade: zReqStr("Which trade? (for example Carpenter)"),
  fromDate: zDate("Pick the first day"),
  toDate: zDate("Pick the last day"),
  required: z.coerce.number({ message: "How many people are needed?" }).int().min(1, "At least 1 person").max(500),
  confirmed: z.coerce.number().int().min(0).max(500).default(0),
  vendorId: zOptStr,
  backupVendorId: zOptStr,
  confirmedNote: zOptStr,
  note: zOptStr,
});

/** Create or change what a project needs. A confirmed headcount needs a note saying who confirmed it (a name, a call, a date). */
export async function saveResourceNeed(id: string | null, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("resources:edit");
    const d = needSchema.parse(formToObject(fd));
    if (d.toDate < d.fromDate) throw new UserError("The last day can't be before the first day.");
    if (d.backupVendorId && d.backupVendorId === d.vendorId) throw new UserError("The backup vendor must be a different vendor.");
    const p = await myProject(c, d.projectId);
    await checkVendor(c, d.vendorId);
    await checkVendor(c, d.backupVendorId);
    const old = id ? await db.resourceNeed.findFirst({ where: { id, companyId: c.companyId } }) : null;
    if (id && !old) throw new UserError("Need not found.");
    if (d.confirmed > 0 && d.confirmed !== (old?.confirmed ?? 0) && !(d.confirmedNote ?? "").trim()) {
      throw new UserError("Say who confirmed these people (the vendor's contact and when). A name typed in a box is not a confirmation.");
    }
    const data = { projectId: d.projectId, trade: d.trade.trim(), fromDate: d.fromDate, toDate: d.toDate, required: d.required, confirmed: d.confirmed, vendorId: d.vendorId ?? null, backupVendorId: d.backupVendorId ?? null, confirmedNote: d.confirmedNote ?? old?.confirmedNote ?? null, note: d.note ?? null };
    const saved = old
      ? await db.resourceNeed.update({ where: { id: old.id }, data })
      : await db.resourceNeed.create({ data: { ...data, companyId: c.companyId, createdById: c.userId } });
    await audit(c, { action: old ? "UPDATE" : "CREATE", entityType: "ResourceNeed", entityId: saved.id, summary: `${c.name} ${old ? "changed" : "added"} the ${data.trade} need for ${p.code}: ${d.required} needed, ${d.confirmed} confirmed` });
    await syncResourceShortages(c.companyId);
    revalidatePath("/resources");
    return { message: d.confirmed >= d.required ? "Saved: the need is covered" : `Saved: ${d.required - d.confirmed} still to confirm` };
  });
}

export async function deleteResourceNeed(id: string) {
  return run(async () => {
    const c = await assertPerm("resources:edit");
    const n = await db.resourceNeed.findFirst({ where: { id, companyId: c.companyId } });
    if (!n) throw new UserError("Need not found.");
    await myProject(c, n.projectId);
    await resolveActionsFor(db, c.companyId, "ResourceNeed", id, c.userId, "The need was removed.");
    await db.resourceNeed.delete({ where: { id } });
    await audit(c, { action: "DELETE", entityType: "ResourceNeed", entityId: id, summary: `${c.name} removed a ${n.trade} need` });
    revalidatePath("/resources");
    return { message: "Removed" };
  });
}

const logSchema = z.object({
  projectId: zReqStr("Choose the site"),
  date: zDate("Pick the day"),
  trade: zReqStr("Which trade?"),
  planned: z.coerce.number({ message: "How many were planned?" }).int().min(0).max(500),
  present: z.coerce.number({ message: "How many actually came?" }).int().min(0).max(500),
  late: z.coerce.number().int().min(0).max(500).default(0),
  vendorId: zOptStr,
  reason: zOptStr,
  replacement: zOptStr,
});

/**
 * The supervisor records, per trade, how many were planned and how many really came. If fewer came, a reason is needed and
 * one action is raised for the coordinator (it closes itself if the day is corrected).
 */
export async function logManpower(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("resources:create");
    const d = logSchema.parse(formToObject(fd));
    const today = calendarDay();
    if (d.date.getTime() > today.getTime()) throw new UserError("You can't record a day that has not happened yet.");
    const wide = ["OWNER", "MANAGEMENT", "ADMIN", "PROJECT_MANAGER", "HR"].includes(c.role);
    if (!wide && today.getTime() - d.date.getTime() > 2 * 86400000) throw new UserError("Only the last 2 days can be recorded by site staff. Ask the project manager for older days.");
    if (d.late > d.present) throw new UserError("People who were late can't be more than the people who came.");
    const short = d.present < d.planned;
    if ((short || d.late > 0) && !(d.reason ?? "").trim()) throw new UserError("Say why people were missing or late. It is recorded against the vendor and helps plan the next job.");
    const p = await myProject(c, d.projectId);
    await checkVendor(c, d.vendorId);
    const data = { planned: d.planned, present: d.present, late: d.late, vendorId: d.vendorId ?? null, reason: d.reason ?? null, replacement: d.replacement ?? null, recordedById: c.userId };
    const log = await db.manpowerLog.upsert({
      where: { projectId_date_trade: { projectId: d.projectId, date: d.date, trade: d.trade.trim() } },
      create: { ...data, companyId: c.companyId, projectId: d.projectId, date: d.date, trade: d.trade.trim() },
      update: data,
    });
    await audit(c, { action: "UPDATE", entityType: "ManpowerLog", entityId: log.id, summary: `${c.name} recorded ${d.trade} at ${p.code} on ${d.date.toISOString().slice(0, 10)}: ${d.present} came of ${d.planned} planned` });

    if (short) {
      const owner = await coordinatorFor(c.companyId, d.projectId);
      if (owner) {
        const sev = shortDaySeverity(d.planned, d.present);
        const r = await raiseAction(db, {
          companyId: c.companyId, title: `${p.code}: only ${d.present} of ${d.planned} ${d.trade.toLowerCase()}s came`, severity: sev, ownerId: owner, createdById: c.userId, projectId: d.projectId,
          dueDate: new Date(d.date.getTime() + 86400000 - 60000 + (sev === "CRITICAL" ? 0 : 86400000)),
          detail: [d.reason, d.replacement && `Done so far: ${d.replacement}`].filter(Boolean).join(" · "), sourceType: "ManpowerLog", sourceId: log.id, sourceLabel: `${d.trade} headcount`, link: "/resources",
        });
        if (r.created && p.projectManagerId && p.projectManagerId !== owner) {
          await notifyUsers([p.projectManagerId], { companyId: c.companyId, type: "GENERAL", title: `Crew short at ${p.code}`, body: `${d.trade}: ${d.present} of ${d.planned} came.`, link: "/resources", dedupeKey: `crew:${log.id}` });
        }
      }
    } else {
      await resolveActionsFor(db, c.companyId, "ManpowerLog", log.id, c.userId, "The day was corrected: everyone planned came.");
    }
    revalidatePath("/resources");
    return { message: short ? `Recorded. ${d.planned - d.present} short: the coordinator has been told.` : "Recorded: full crew" };
  });
}

/** Who is told first when a crew is short. Owner / Admin only. */
export async function setResourceCoordinator(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("settings:manage");
    const { userId } = z.object({ userId: zOptStr }).parse(formToObject(fd));
    if (userId && !(await db.user.findFirst({ where: { id: userId, companyId: c.companyId, isActive: true, deletedAt: null, role: { notIn: ["CLIENT", "VENDOR", "WORKER"] } }, select: { id: true } }))) throw new UserError("Choose someone from your team.");
    await db.companySettings.update({ where: { companyId: c.companyId }, data: { resourceCoordinatorId: userId ?? null } });
    await audit(c, { action: "UPDATE", entityType: "Settings", summary: `${c.name} ${userId ? "named a resource coordinator" : "removed the resource coordinator"}` });
    revalidatePath("/resources");
    return { message: userId ? "Coordinator saved" : "Coordinator removed (project managers are told instead)" };
  });
}
