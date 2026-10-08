"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RoleKey } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { formToObject, zEmail, zGstin, zNumPos, zOptStr, zPan, zPhone, zReqStr } from "@/lib/form";

const companySchema = z.object({
  legalName: zReqStr("Company name is required"),
  address: zOptStr,
  phone: zPhone,
  email: zEmail,
  website: zOptStr,
  gstin: zGstin,
  pan: zPan,
  bankName: zOptStr,
  bankAccountNo: zOptStr,
  bankIfsc: zOptStr,
  bankBranch: zOptStr,
  invoicePrefix: zReqStr(),
  quotationPrefix: zReqStr(),
  poPrefix: zReqStr(),
  defaultTaxPercent: zNumPos().max(100),
  approvalLevel1: zNumPos(),
  approvalLevel2: zNumPos(),
});

export async function saveCompanySettings(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("settings:manage");
    const d = companySchema.parse(formToObject(fd));
    if (d.approvalLevel2 < d.approvalLevel1) throw new UserError("Level 2 limit must be higher than Level 1 limit.");
    const old = await db.companySettings.findUnique({ where: { companyId: c.companyId } });
    await db.companySettings.upsert({
      where: { companyId: c.companyId },
      update: d,
      create: { companyId: c.companyId, ...d },
    });
    await audit(c, {
      action: "UPDATE", entityType: "CompanySettings", entityId: c.companyId,
      summary: "Company settings updated", oldValue: old, newValue: d,
    });
    revalidatePath("/settings/company");
    return { message: "Company settings saved" };
  });
}

const userSchema = z.object({
  name: zReqStr("Name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: zPhone,
  role: z.nativeEnum(RoleKey, { message: "Select a role" }),
  password: z.string().min(8, "Use at least 8 characters").optional(),
});

function guardRole(actorRole: RoleKey, target: RoleKey) {
  if ((target === "OWNER" || target === "MANAGEMENT") && actorRole !== "OWNER") {
    throw new UserError("Only the Owner can assign the Owner or Management role.");
  }
}

export async function createUser(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("users:manage");
    const d = userSchema.extend({ password: z.string().min(8, "Use at least 8 characters") }).parse(formToObject(fd));
    guardRole(c.role, d.role);
    const exists = await db.user.findFirst({ where: { companyId: c.companyId, email: d.email, deletedAt: null } });
    if (exists) throw new UserError("A user with this email already exists.");
    const u = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { companyId: c.companyId, name: d.name, email: d.email, phone: d.phone, role: d.role, passwordHash: await hashPassword(d.password) },
      });
      const count = await tx.employee.count({ where: { companyId: c.companyId } });
      const staff = !["WORKER", "CLIENT", "VENDOR"].includes(d.role);
      if (staff) {
        await tx.employee.create({
          data: { companyId: c.companyId, userId: user.id, code: `EMP-${String(count + 1).padStart(3, "0")}`, name: d.name, email: d.email, phone: d.phone },
        });
      }
      await audit(c, { action: "CREATE", entityType: "User", entityId: user.id, summary: `Created user ${d.name} (${d.role})`, newValue: { email: d.email, role: d.role } }, tx);
      return user;
    });
    revalidatePath("/settings/team");
    return { message: `User ${u.name} created`, data: { id: u.id } };
  });
}

export async function updateUser(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("users:manage");
    const d = userSchema.omit({ password: true }).parse(formToObject(fd));
    const user = await db.user.findFirst({ where: { id, companyId: c.companyId } });
    if (!user) throw new UserError("User not found.");
    guardRole(c.role, d.role);
    guardRole(c.role, user.role);
    if (id === c.userId && d.role !== user.role) throw new UserError("You can't change your own role.");
    const dup = await db.user.findFirst({ where: { companyId: c.companyId, email: d.email, id: { not: id }, deletedAt: null } });
    if (dup) throw new UserError("Another user already uses this email.");
    await db.user.update({ where: { id }, data: { name: d.name, email: d.email, phone: d.phone, role: d.role } });
    await audit(c, {
      action: "UPDATE", entityType: "User", entityId: id,
      summary: `Updated user ${d.name}${user.role !== d.role ? `: role ${user.role} → ${d.role}` : ""}`,
      oldValue: { name: user.name, email: user.email, role: user.role }, newValue: d,
    });
    revalidatePath("/settings/team");
    return { message: "User updated" };
  });
}

export async function setUserActive(id: string, active: boolean) {
  return run(async () => {
    const c = await assertPerm("users:manage");
    if (id === c.userId) throw new UserError("You can't deactivate your own account.");
    const user = await db.user.findFirst({ where: { id, companyId: c.companyId } });
    if (!user) throw new UserError("User not found.");
    guardRole(c.role, user.role);
    await db.user.update({ where: { id }, data: { isActive: active } });
    await audit(c, { action: active ? "ACTIVATE" : "DEACTIVATE", entityType: "User", entityId: id, summary: `${active ? "Activated" : "Deactivated"} user ${user.name}` });
    revalidatePath("/settings/team");
    return { message: active ? "User activated" : "User deactivated" };
  });
}

export async function resetPassword(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("users:manage");
    const { password } = z.object({ password: z.string().min(8, "Use at least 8 characters") }).parse(formToObject(fd));
    const user = await db.user.findFirst({ where: { id, companyId: c.companyId } });
    if (!user) throw new UserError("User not found.");
    guardRole(c.role, user.role);
    await db.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    await audit(c, { action: "UPDATE", entityType: "User", entityId: id, summary: `Password reset for ${user.name}` });
    return { message: "Password updated" };
  });
}
