"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { run, UserError } from "@/lib/action";
import { RULES } from "@/lib/time-limits";

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function saveTimeLimits(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("settings:manage");
    const tat: Record<string, number> = {};
    for (const r of RULES) {
      const raw = String(fd.get(`rule_${r.key}`) ?? "").trim();
      if (!raw) { tat[r.key] = r.defaultHours; continue; }
      const h = Number(raw);
      if (!Number.isFinite(h) || h < 1 || h > 24 * 90) throw new UserError(`“${r.title}”: enter hours between 1 and 2160.`);
      tat[r.key] = Math.round(h);
    }
    const times: Record<string, string> = {};
    for (const [field, label] of [["reportMorningDue", "Morning update (city sites)"], ["reportMorningDueOutstation", "Morning update (outstation sites)"], ["reportEveningDue", "Evening report"]] as const) {
      const v = String(fd.get(field) ?? "").trim();
      if (!HHMM.test(v)) throw new UserError(`${label}: enter a time like 10:00.`);
      times[field] = v.padStart(5, "0");
    }
    const rules: Record<string, number> = {};
    for (const [field, label, min, max] of [["materialNoticeDays", "Material request notice (days)", 0, 30], ["leaveNoticeDays", "Regular leave notice (days)", 0, 120], ["longLeaveNoticeDays", "Long leave notice (days)", 0, 365], ["leaveYearlyCap", "Yearly leave limit (days)", 1, 365]] as const) {
      const raw = String(fd.get(field) ?? "").trim();
      if (!raw) continue; // blank keeps the current value
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${label}: enter a whole number from ${min} to ${max}.`);
      rules[field] = n;
    }
    await db.companySettings.update({ where: { companyId: c.companyId }, data: { tatConfig: tat, ...times, ...rules } });
    await audit(c, { action: "UPDATE", entityType: "Settings", summary: "Changed time limits and site report deadlines", newValue: { tat, times } });
    revalidatePath("/settings/time-limits");
    revalidatePath("/time-limits");
    revalidatePath("/site-reports");
    return { message: "Time limits saved" };
  });
}
