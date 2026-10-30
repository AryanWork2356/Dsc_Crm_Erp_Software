import "server-only";
import { after } from "next/server";
import type { NotificationType, RoleKey } from "@prisma/client";
import { db, type Tx } from "./db";
import { sendPush } from "./push";

type N = {
  companyId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Prevents the same scheduled alert being created twice for a user */
  dedupeKey?: string;
};

/**
 * Notify specific users: in the app (the bell), and on their phone if they turned phone alerts on. The phone alert is sent after the
 * page has answered (it never slows down or breaks the action), and only for alerts that are new (a repeated reminder is not sent twice).
 */
export async function notifyUsers(userIds: string[], n: N, tx?: Tx) {
  const client = tx ?? db;
  let ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  if (n.dedupeKey) {
    const had = await client.notification.findMany({ where: { userId: { in: ids }, dedupeKey: n.dedupeKey }, select: { userId: true } });
    const seen = new Set(had.map((h) => h.userId));
    ids = ids.filter((id) => !seen.has(id));
    if (!ids.length) return;
  }
  await client.notification.createMany({
    data: ids.map((userId) => ({ companyId: n.companyId, userId, type: n.type, title: n.title, body: n.body, link: n.link, dedupeKey: n.dedupeKey })),
    skipDuplicates: true,
  });
  const push = () => sendPush(ids, { title: n.title, body: n.body, url: n.link, tag: n.dedupeKey }).catch((e) => console.error("push failed", e));
  try {
    after(push);
  } catch {
    // not inside a request (scripts, tests): only send when there is someone who turned alerts on
    if (process.env.NODE_ENV !== "test") await push();
  }
}

/** Notify everyone holding any of the given roles. */
export async function notifyRoles(companyId: string, roles: RoleKey[], n: Omit<N, "companyId">, tx?: Tx) {
  const client = tx ?? db;
  const users = await client.user.findMany({ where: { companyId, role: { in: roles }, isActive: true, deletedAt: null }, select: { id: true } });
  await notifyUsers(users.map((u) => u.id), { ...n, companyId }, tx);
}
