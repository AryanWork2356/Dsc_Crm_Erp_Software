import "server-only";
import type { NotificationType, RoleKey } from "@prisma/client";
import { db, type Tx } from "./db";

type N = {
  companyId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Prevents the same scheduled alert being created twice for a user */
  dedupeKey?: string;
};

/** Notify specific users. In-app today; email/WhatsApp providers can hook in here later. */
export async function notifyUsers(userIds: string[], n: N, tx?: Tx) {
  const client = tx ?? db;
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  await client.notification.createMany({
    data: ids.map((userId) => ({ companyId: n.companyId, userId, type: n.type, title: n.title, body: n.body, link: n.link, dedupeKey: n.dedupeKey })),
    skipDuplicates: true,
  });
}

/** Notify everyone holding any of the given roles. */
export async function notifyRoles(companyId: string, roles: RoleKey[], n: Omit<N, "companyId">, tx?: Tx) {
  const client = tx ?? db;
  const users = await client.user.findMany({ where: { companyId, role: { in: roles }, isActive: true, deletedAt: null }, select: { id: true } });
  await notifyUsers(users.map((u) => u.id), { ...n, companyId }, tx);
}
