"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run } from "@/lib/action";
import { formToObject, zOptStr } from "@/lib/form";
import { CHARGE_KINDS } from "@/lib/company-profit";

const schema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose the month"),
  kind: z.enum(["DEPRECIATION", "INTEREST", "TAX"], { message: "Choose what the amount is" }),
  amount: z.coerce.number({ message: "Enter the amount" }).min(0, "The amount cannot be negative").max(1e11),
  note: zOptStr,
});

/**
 * Accounts types in a cost that sits below EBITDA for one month. Saving the same month and kind again replaces the amount
 * (enter 0 to remove it). Only people who may see company finance and margins can do this, and every change is in the audit log.
 */
export async function saveCompanyCharge(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("finance:view");
    await assertPerm("margins:view");
    const d = schema.parse(formToObject(fd));
    const [year, month] = d.period.split("-").map(Number);
    const where = { companyId_year_month_kind: { companyId: c.companyId, year, month, kind: d.kind } };
    const old = await db.companyCharge.findUnique({ where });
    if (d.amount === 0) {
      if (old) await db.companyCharge.delete({ where });
    } else {
      await db.companyCharge.upsert({ where, create: { companyId: c.companyId, year, month, kind: d.kind, amount: d.amount, note: d.note ?? null, updatedById: c.userId }, update: { amount: d.amount, note: d.note ?? null, updatedById: c.userId } });
    }
    await audit(c, { action: old ? "UPDATE" : "CREATE", entityType: "CompanyCharge", entityId: `${d.period}:${d.kind}`, summary: `${CHARGE_KINDS[d.kind]} for ${d.period}: ${d.amount === 0 ? "removed" : d.amount}`, oldValue: old ? { amount: Number(old.amount) } : undefined, newValue: { amount: d.amount } });
    revalidatePath("/finance/profit");
    return { message: d.amount === 0 ? "Removed" : `${CHARGE_KINDS[d.kind]} saved` };
  });
}
