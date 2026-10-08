import "server-only";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "./auth";
import { SEES_ALL_PROJECTS } from "./permissions";

/**
 * Row-level data scoping. Permissions say WHAT a role can do; scopes say WHICH rows it can see.
 * Always merge these into the `where` of list/detail queries (and re-check on mutations).
 */

const LEAD_ALL: string[] = ["OWNER", "MANAGEMENT", "ADMIN"];

export function leadScope(c: Ctx): Prisma.LeadWhereInput {
  const base: Prisma.LeadWhereInput = { companyId: c.companyId, deletedAt: null };
  if (LEAD_ALL.includes(c.role)) return base;
  // Sales only see leads assigned to them
  return { ...base, assignedToId: c.userId };
}

export function projectScope(c: Ctx): Prisma.ProjectWhereInput {
  const base: Prisma.ProjectWhereInput = { companyId: c.companyId, deletedAt: null };
  if (c.role === "CLIENT") return { ...base, clientId: c.clientId ?? "none" };
  if (SEES_ALL_PROJECTS.includes(c.role)) return base;
  return {
    ...base,
    OR: [
      { projectManagerId: c.userId },
      { designerId: c.userId },
      { siteEngineerId: c.userId },
      { supervisorId: c.userId },
      { members: { some: { userId: c.userId } } },
    ],
  };
}

/** Stricter than projectScope: only people actually assigned to the project (plus the listed wide-access roles). Used for contracts/drawings. */
const DOC_ALL_PROJECTS: string[] = ["OWNER", "MANAGEMENT", "ADMIN", "ACCOUNTS", "PROCUREMENT"];
export function projectDocScope(c: Ctx): Prisma.ProjectWhereInput {
  const base: Prisma.ProjectWhereInput = { companyId: c.companyId, deletedAt: null };
  if (c.role === "CLIENT") return { ...base, clientId: c.clientId ?? "none" };
  if (DOC_ALL_PROJECTS.includes(c.role)) return base;
  return { ...base, OR: [{ projectManagerId: c.userId }, { designerId: c.userId }, { siteEngineerId: c.userId }, { supervisorId: c.userId }, { members: { some: { userId: c.userId } } }] };
}

export function clientScope(c: Ctx): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = { companyId: c.companyId, deletedAt: null };
  if (c.role === "CLIENT") return { ...base, id: c.clientId ?? "none" };
  return base;
}

/** Project ids visible to the user (used to scope tasks, expenses, issues etc.). */
export async function visibleProjectIds(c: Ctx, db: { project: { findMany: (a: object) => Promise<{ id: string }[]> } }) {
  const rows = await db.project.findMany({ where: projectScope(c), select: { id: true } });
  return rows.map((r) => r.id);
}
