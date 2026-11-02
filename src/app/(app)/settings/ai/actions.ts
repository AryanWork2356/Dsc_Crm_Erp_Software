"use server";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { run, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { canControlAi } from "@/lib/ai";

/** The master switch for every AI feature. Only Aryan Shetty and Rupesh Sharma (the Owner logins) may flip it. */
export async function setAiEnabled(enabled: boolean) {
  return run(async () => {
    const c = await getCtx();
    if (!c || !canControlAi(c)) throw new UserError("Only Aryan Shetty and Rupesh Sharma can switch the AI helper on or off.");
    const exists = await db.companySettings.findUnique({ where: { companyId: c.companyId }, select: { id: true } });
    if (!exists) throw new UserError("Company settings were not found.");
    await db.companySettings.update({ where: { companyId: c.companyId }, data: { aiEnabled: enabled } });
    await audit(c, { action: "UPDATE", entityType: "Settings", summary: `${c.name} switched the AI helper ${enabled ? "ON" : "OFF"}`, newValue: { aiEnabled: enabled } });
    revalidatePath("/", "layout");
    return { message: enabled ? "The AI helper is ON." : "The AI helper is OFF. The app is as it was before AI." };
  });
}
