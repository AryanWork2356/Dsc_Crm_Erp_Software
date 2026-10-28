"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { checkPassword, endSession, getCtx, requestMeta, startSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { homeFor } from "@/lib/home";
import { fullLoginId } from "@/lib/issued-password";
import { notifyRoles } from "@/lib/notify";

export type LoginState = { error?: string } | undefined;

const schema = z.object({
  email: z.string().trim().min(1, "Enter your login ID").transform(fullLoginId).pipe(z.string().email("Enter your login ID")),
  password: z.string().min(1, "Enter your password"),
});

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password } = parsed.data;

  const meta = await requestMeta();
  // 8 attempts / 10 min per email+ip
  if (!rateLimit(`login:${email}:${meta.ip ?? "?"}`, 8, 10 * 60 * 1000)) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  const user = await db.user.findFirst({ where: { email, isActive: true, deletedAt: null } });
  // 5 wrong passwords in a row lock the login for 15 minutes (kept in the database, so it holds on every server)
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    return { error: `Too many wrong passwords. This login is locked for ${mins} more minute${mins === 1 ? "" : "s"}. Wait, or ask the Owner or Admin.` };
  }
  // same message for unknown user / wrong password (no account enumeration)
  const ok = user ? await checkPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    if (user) {
      const n = user.failedLogins + 1;
      if (n >= 5) {
        await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + 15 * 60000) } });
        await notifyRoles(user.companyId, ["OWNER", "ADMIN"], { type: "GENERAL", title: `Login locked: ${user.name}`, body: `5 wrong passwords were typed for ${user.email}. It is locked for 15 minutes. If it was not ${user.name}, someone may be guessing the password.`, link: "/settings/team", dedupeKey: `lock:${user.id}:${new Date().toISOString().slice(0, 13)}` });
        await audit({ companyId: user.companyId, userId: user.id, name: user.name }, { action: "UPDATE", entityType: "User", entityId: user.id, summary: `Login locked for 15 minutes after 5 wrong passwords (${user.email})` });
      } else {
        await db.user.update({ where: { id: user.id }, data: { failedLogins: n } });
      }
    }
    return { error: "Incorrect login ID or password." };
  }
  if (user.failedLogins || user.lockedUntil) await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });

  await startSession(user.id, user.companyId);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ companyId: user.companyId, userId: user.id, name: user.name }, {
    action: "LOGIN",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} signed in`,
  });

  // a password somebody else gave them (the Admin, or the setup tool) must be replaced before anything else
  if (user.mustChangePassword) redirect("/change-password");

  const next = fd.get("next");
  if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && next !== "/login") redirect(next);
  redirect(homeFor(user.role));
}

export async function logout() {
  const c = await getCtx();
  if (c) await audit(c, { action: "LOGOUT", entityType: "User", entityId: c.userId, summary: `${c.name} signed out` });
  await endSession();
  redirect("/login");
}
