"use server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requestMeta } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { notifyRoles } from "@/lib/notify";

export type ForgotState = { done?: boolean; error?: string } | undefined;

/**
 * "I forgot my password". There is no e-mail or SMS in the app, so this tells the Owner and Admin, who check that it is
 * really the person and then press Reset password (which gives a temporary password the person must replace).
 * Everyone gets the same answer whether or not the login ID exists, so nobody can use this to find out who works here.
 */
export async function requestPasswordReset(_prev: ForgotState, fd: FormData): Promise<ForgotState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Type your login ID (it looks like name.surname@dscinterior.com)." };
  const meta = await requestMeta();
  if (!rateLimit(`forgot-ip:${meta.ip ?? "?"}`, 6, 15 * 60 * 1000) || !rateLimit(`forgot:${email}`, 3, 60 * 60 * 1000)) return { error: "Too many requests. Please wait a while, or phone your Admin." };
  const u = await db.user.findFirst({ where: { email, isActive: true, deletedAt: null } });
  if (u) {
    await db.user.update({ where: { id: u.id }, data: { resetRequestedAt: new Date() } });
    await notifyRoles(u.companyId, ["OWNER", "ADMIN"], { type: "GENERAL", title: `Password reset asked: ${u.name}`, body: `${u.email} cannot sign in. Check that it is really ${u.name}, then press Reset password on their line.`, link: "/settings/team", dedupeKey: `pwreset:${u.id}:${new Date().toISOString().slice(0, 10)}` });
    await audit({ companyId: u.companyId, userId: u.id, name: u.name }, { action: "UPDATE", entityType: "User", entityId: u.id, summary: `${u.name} asked for a password reset` });
  }
  return { done: true };
}
