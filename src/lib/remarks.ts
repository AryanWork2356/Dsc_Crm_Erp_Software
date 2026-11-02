import "server-only";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "./auth";
import { projectScope } from "./scope";

/** Who answers remarks and sees all of them: directors and admins. Others see the remarks they wrote and those on their projects. */
export const REMARK_STAFF = ["OWNER", "MANAGEMENT", "ADMIN"];
export const isRemarkStaff = (c: Pick<Ctx, "role">) => REMARK_STAFF.includes(c.role);

export function remarkScope(c: Ctx): Prisma.RemarkWhereInput {
  const base: Prisma.RemarkWhereInput = { companyId: c.companyId };
  if (isRemarkStaff(c)) return base;
  return { ...base, OR: [{ createdById: c.userId }, { project: projectScope(c) }] };
}
