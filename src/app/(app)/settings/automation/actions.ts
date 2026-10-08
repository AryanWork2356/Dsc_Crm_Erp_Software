"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run } from "@/lib/action";
import { runDailyAutomations } from "@/lib/automation";

export async function runAutomationsNow() {
  return run(async () => {
    const c = await assertPerm("settings:manage");
    const r = await runDailyAutomations(c.companyId);
    await audit(c, { action: "UPDATE", entityType: "Automation", summary: `${c.name} ran the daily automations manually` });
    revalidatePath("/settings/automation");
    revalidatePath("/notifications");
    return { message: `Done – ${Object.values(r).reduce((a, b) => a + b, 0)} items checked` };
  });
}
