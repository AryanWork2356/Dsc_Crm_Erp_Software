"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { checkPassword, endSession, getCtx, requestMeta, startSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { homeFor } from "@/lib/home";

export type LoginState = { error?: string } | undefined;

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
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
  // same message for unknown user / wrong password (no account enumeration)
  const ok = user ? await checkPassword(password, user.passwordHash) : false;
  if (!user || !ok) return { error: "Incorrect email or password." };

  await startSession(user.id, user.companyId);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ companyId: user.companyId, userId: user.id, name: user.name }, {
    action: "LOGIN",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} signed in`,
  });

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
