"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { run, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { DIRECTOR_ROLES } from "@/lib/permissions";
import { formToObject, zOptStr, zReqStr } from "@/lib/form";
import { isGiver, isOffice, officePeople } from "@/lib/daily-work";
import { reportDay } from "@/lib/site-reports";

const give = z.object({
  assignedToId: zReqStr("Choose who the work is for"),
  title: zReqStr("Write what the work is").pipe(z.string().max(200)),
  details: zOptStr,
  dueDate: zOptStr,
  dueTime: zOptStr,
});

/** A director gives work to one office employee, or to everyone in the office. The time it was given is recorded. */
export async function giveWork(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("daily_work:view");
    if (!isGiver(c)) throw new UserError("Only the directors give daily work.");
    const d = give.parse(formToObject(fd));
    const people = await officePeople(c.companyId);
    const to = d.assignedToId === "ALL" ? people : people.filter((p) => p.id === d.assignedToId);
    if (!to.length) throw new UserError("That person was not found. Reload the page and choose again.");
    let dueAt: Date | null = null;
    if (d.dueDate) {
      dueAt = new Date(`${d.dueDate}T${/^\d{1,2}:\d{2}$/.test(d.dueTime ?? "") ? d.dueTime!.padStart(5, "0") : "18:00"}:00+05:30`);
      if (Number.isNaN(dueAt.getTime())) throw new UserError("That finish date is not valid.");
    }
    await db.$transaction(async (tx) => {
      for (const p of to) {
        const w = await tx.dailyWork.create({ data: { companyId: c.companyId, assignedToId: p.id, assignedById: c.userId, title: d.title, details: d.details || null, dueAt } });
        await audit(c, { action: "CREATE", entityType: "DailyWork", entityId: w.id, summary: `${c.name} gave work to ${p.name}: ${d.title}` }, tx);
      }
      await notifyUsers(to.map((p) => p.id), { companyId: c.companyId, type: "GENERAL", title: `New work from ${c.name}`, body: d.title.slice(0, 300), link: "/daily-work" }, tx);
    });
    revalidatePath("/daily-work");
    return { message: to.length > 1 ? `Work given to ${to.length} people` : `Work given to ${to[0].name}` };
  });
}

/** The person it was given to marks it finished. The time is recorded and the director who gave it is told. */
export async function markWorkDone(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("daily_work:view");
    const note = z.string().trim().max(1000).optional().parse(formToObject(fd).note);
    const w = await db.dailyWork.findFirst({ where: { id, companyId: c.companyId, assignedToId: c.userId } });
    if (!w) throw new UserError("This work is not yours, or it was removed.");
    if (w.status === "DONE") return { message: "Already marked done" };
    await db.$transaction(async (tx) => {
      await tx.dailyWork.update({ where: { id }, data: { status: "DONE", doneAt: new Date(), doneNote: note || null } });
      await audit(c, { action: "UPDATE", entityType: "DailyWork", entityId: id, summary: `${c.name} finished: ${w.title}` }, tx);
      if (w.assignedById !== c.userId) await notifyUsers([w.assignedById], { companyId: c.companyId, type: "GENERAL", title: `${c.name} finished the work`, body: w.title.slice(0, 300), link: "/daily-work" }, tx);
    });
    revalidatePath("/daily-work");
    return { message: "Marked done. The director can see the time." };
  });
}

/** A director takes back work that was given by mistake (only while it is still pending). */
export async function removeWork(id: string) {
  return run(async () => {
    const c = await assertPerm("daily_work:view");
    if (!isGiver(c)) throw new UserError("Only the directors can remove given work.");
    const w = await db.dailyWork.findFirst({ where: { id, companyId: c.companyId } });
    if (!w) throw new UserError("Work not found.");
    if (w.status === "DONE") throw new UserError("This work is already finished, so it stays in the record.");
    await db.$transaction(async (tx) => {
      await tx.dailyWork.delete({ where: { id } });
      await audit(c, { action: "DELETE", entityType: "DailyWork", entityId: id, summary: `${c.name} removed work given: ${w.title}` }, tx);
    });
    revalidatePath("/daily-work");
    return { message: "Removed" };
  });
}

const log = z.object({ day: zOptStr, body: zReqStr("Write what you did today").pipe(z.string().min(3, "Write a little more").max(6000)) });

/** An office employee writes what they did. One report per day: writing again the same day replaces it. Today or up to a week back. */
export async function saveDailyReport(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("daily_work:create");
    if (!isOffice(c)) throw new UserError("The daily report is written by the office team.");
    const d = log.parse(formToObject(fd));
    const today = reportDay();
    const day = d.day ? new Date(`${d.day}T00:00:00.000Z`) : today;
    if (Number.isNaN(day.getTime())) throw new UserError("That date is not valid.");
    if (day > today) throw new UserError("You cannot write a report for a day that has not come yet.");
    if (today.getTime() - day.getTime() > 7 * 86400000) throw new UserError("You can write a report for today or up to a week back.");
    await db.$transaction(async (tx) => {
      await tx.dailyLog.upsert({ where: { userId_day: { userId: c.userId, day } }, create: { companyId: c.companyId, userId: c.userId, day, body: d.body }, update: { body: d.body } });
      // the directors are told once per person per day (editing the report later does not send it again)
      const key = day.toISOString().slice(0, 10);
      await notifyRoles(c.companyId, DIRECTOR_ROLES, { type: "GENERAL", title: `${c.name} wrote ${day.getTime() === today.getTime() ? "today's" : "a"} daily report`, body: d.body.replace(/\s+/g, " ").slice(0, 200), link: `/daily-work?tab=report&day=${key}`, dedupeKey: `dailylog:${c.userId}:${key}` }, tx);
    });
    revalidatePath("/daily-work");
    return { message: "Your daily report is saved" };
  });
}
