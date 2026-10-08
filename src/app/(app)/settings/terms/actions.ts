"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { formToObject, zReqStr } from "@/lib/form";

const schema = z.object({ kind: z.enum(["QUOTATION", "PO", "INVOICE"], { message: "Choose where it is used" }), name: zReqStr("Give the template a name"), body: zReqStr("Write the terms"), isDefault: z.boolean().default(false) });

export async function saveTerms(id: string | null, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("settings:manage");
    const d = schema.parse(formToObject(fd));
    if (id && !(await db.termsAndConditions.findFirst({ where: { id, companyId: c.companyId } }))) throw new UserError("Template not found.");
    await db.$transaction(async (tx) => {
      // only one default per kind
      if (d.isDefault) await tx.termsAndConditions.updateMany({ where: { companyId: c.companyId, kind: d.kind, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
      const row = id ? await tx.termsAndConditions.update({ where: { id }, data: d }) : await tx.termsAndConditions.create({ data: { ...d, companyId: c.companyId } });
      await audit(c, { action: id ? "UPDATE" : "CREATE", entityType: "TermsAndConditions", entityId: row.id, summary: `${id ? "Updated" : "Created"} ${d.kind.toLowerCase()} terms “${d.name}”${d.isDefault ? " (default)" : ""}` }, tx);
    });
    revalidatePath("/settings/terms");
    return { message: "Terms saved" };
  });
}

export async function deleteTerms(id: string) {
  return run(async () => {
    const c = await assertPerm("settings:manage");
    const t = await db.termsAndConditions.findFirst({ where: { id, companyId: c.companyId } });
    if (!t) throw new UserError("Template not found.");
    await db.termsAndConditions.delete({ where: { id } });
    await audit(c, { action: "DELETE", entityType: "TermsAndConditions", entityId: id, summary: `Deleted terms template “${t.name}”` });
    revalidatePath("/settings/terms");
    return { message: "Template deleted" };
  });
}
