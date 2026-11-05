import "server-only";
import type { Ctx } from "./auth";
import { DIRECTOR_ROLES, OFFICE_ROLES } from "./permissions";
import { db } from "./db";
import { TEST_LOGIN_PREFIX } from "./lookups";

/** Directors give work and see everyone's reports. */
export const isGiver = (c: Pick<Ctx, "role">) => DIRECTOR_ROLES.includes(c.role);
/** Office employees receive work and write the daily report. */
export const isOffice = (c: Pick<Ctx, "role">) => OFFICE_ROLES.includes(c.role);

/** The people a director can give work to: active office employees. */
export async function officePeople(companyId: string) {
  return db.user.findMany({
    where: { companyId, isActive: true, deletedAt: null, role: { in: OFFICE_ROLES }, NOT: { name: { startsWith: TEST_LOGIN_PREFIX } } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}
