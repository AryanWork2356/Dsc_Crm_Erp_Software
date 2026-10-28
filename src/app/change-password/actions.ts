"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { checkPassword, getCtx, hashPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { homeFor } from "@/lib/home";
import { passwordProblem } from "@/lib/password-rules";

export type PwState = { error?: string } | undefined;

/**
 * A signed-in person chooses their own password. The login ID is never changed here: IDs are given by the company.
 * Needs the current password, so someone at an unlocked screen cannot take the account over.
 */
export async function changeMyPassword(_prev: PwState, fd: FormData): Promise<PwState> {
  const c = await getCtx();
  if (!c) redirect("/login");
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  const again = String(fd.get("again") ?? "");
  if (!rateLimit(`pwchange:${c.userId}`, 6, 15 * 60 * 1000)) return { error: "Too many tries. Please wait a few minutes." };
  const user = await db.user.findUnique({ where: { id: c.userId } });
  if (!user || !(await checkPassword(current, user.passwordHash))) return { error: "Your current password is not right." };
  if (next !== again) return { error: "The two new passwords are not the same." };
  const problem = passwordProblem(next, user.email, current);
  if (problem) return { error: problem };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false, passwordChangedAt: new Date(), resetRequestedAt: null } });
  await audit(c, { action: "UPDATE", entityType: "User", entityId: user.id, summary: `${c.name} changed their own password` });
  redirect(homeFor(c.role));
}
