import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";
import type { Ctx } from "./auth";
import { requestMeta } from "./auth";

type AuditInput = {
  action: string; // CREATE | UPDATE | DELETE | APPROVE | REJECT | LOGIN | ...
  entityType: string;
  entityId?: string | null;
  summary: string;
  oldValue?: unknown;
  newValue?: unknown;
};

/** Writes an immutable audit entry. Pass `tx` to make it part of the caller's transaction. */
export async function audit(c: Pick<Ctx, "companyId" | "userId" | "name">, a: AuditInput, tx?: Tx) {
  const meta = await requestMeta().catch(() => ({ ip: null, userAgent: null }));
  const client = tx ?? db;
  await client.auditLog.create({
    data: {
      companyId: c.companyId,
      userId: c.userId,
      userName: c.name,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ?? null,
      summary: a.summary,
      oldValue: (a.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (a.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
}
