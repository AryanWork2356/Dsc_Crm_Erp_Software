import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import type { RoleKey } from "@prisma/client";
import { db } from "./db";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./session";
import { can, type PermissionKey } from "./permissions";

export type Ctx = {
  userId: string;
  companyId: string;
  role: RoleKey;
  name: string;
  email: string;
  clientId: string | null;
  vendorId: string | null;
  workerId: string | null;
  can: (p: PermissionKey) => boolean;
};

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

/** Current user, re-validated against the DB on every request (deactivated users lose access immediately). */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await verifySession(token);
  if (!s) return null;
  const u = await db.user.findFirst({
    where: { id: s.uid, companyId: s.cid, isActive: true, deletedAt: null },
  });
  if (!u) return null;
  return {
    userId: u.id,
    companyId: u.companyId,
    role: u.role,
    name: u.name,
    email: u.email,
    clientId: u.clientId,
    vendorId: u.vendorId,
    workerId: u.workerId,
    can: (p) => can(u.role, p),
  };
});

export async function requireCtx(): Promise<Ctx> {
  const c = await getCtx();
  if (!c) redirect("/login");
  return c;
}

/** Page-level guard: redirects to /forbidden when permission is missing. */
export async function requirePerm(perm: PermissionKey): Promise<Ctx> {
  const c = await requireCtx();
  if (!c.can(perm)) redirect("/forbidden");
  return c;
}

export class PermissionError extends Error {
  constructor(perm: string) {
    super(`You don't have permission to do this (${perm}).`);
  }
}

/** Action-level guard: throws instead of redirecting so actions can report a clean error. */
export async function assertPerm(perm: PermissionKey): Promise<Ctx> {
  const c = await getCtx();
  if (!c) throw new Error("Your session has expired. Please sign in again.");
  if (!c.can(perm)) throw new PermissionError(perm);
  return c;
}

export async function startSession(userId: string, companyId: string) {
  const token = await signSession({ uid: userId, cid: companyId });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent")?.slice(0, 250) ?? null,
  };
}
