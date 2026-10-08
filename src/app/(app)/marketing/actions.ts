"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { formToObject, zNumPos, zOptDate, zOptStr, zReqStr } from "@/lib/form";

const schema = z.object({ name: zReqStr("Campaign name is required"), channel: zReqStr("Select the channel"), startDate: zOptDate, endDate: zOptDate, spend: zNumPos().default(0), notes: zOptStr });

export async function createCampaign(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("marketing:create");
    const d = schema.parse(formToObject(fd));
    if (d.startDate && d.endDate && d.endDate < d.startDate) throw new UserError("End date can't be before the start date.");
    const x = await db.marketingCampaign.create({ data: { ...d, companyId: c.companyId } });
    await audit(c, { action: "CREATE", entityType: "MarketingCampaign", entityId: x.id, summary: `Created campaign “${d.name}” on ${d.channel} (₹${d.spend.toLocaleString("en-IN")})` });
    revalidatePath("/marketing");
    return { message: "Campaign added" };
  });
}

export async function updateCampaign(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("marketing:edit");
    const d = schema.parse(formToObject(fd));
    if (d.startDate && d.endDate && d.endDate < d.startDate) throw new UserError("End date can't be before the start date.");
    const old = await db.marketingCampaign.findFirst({ where: { id, companyId: c.companyId } });
    if (!old) throw new UserError("Campaign not found.");
    await db.marketingCampaign.update({ where: { id }, data: d });
    await audit(c, { action: "UPDATE", entityType: "MarketingCampaign", entityId: id, summary: `Updated campaign “${d.name}”` });
    revalidatePath("/marketing");
    return { message: "Campaign updated" };
  });
}

export async function deleteCampaign(id: string) {
  return run(async () => {
    const c = await assertPerm("marketing:delete");
    const old = await db.marketingCampaign.findFirst({ where: { id, companyId: c.companyId } });
    if (!old) throw new UserError("Campaign not found.");
    await db.marketingCampaign.delete({ where: { id } });
    await audit(c, { action: "DELETE", entityType: "MarketingCampaign", entityId: id, summary: `Deleted campaign “${old.name}”` });
    revalidatePath("/marketing");
    return { message: "Campaign deleted" };
  });
}
