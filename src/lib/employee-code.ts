import type { Tx } from "./db";
import { db } from "./db";
import { nextNumber } from "./sequence";

/**
 * The next free employee code (EMP-001 …). Skips any code that is already taken, so people added by
 * "Add user", "Add employee", an import, or an older numbering can never collide.
 */
export async function nextEmployeeCode(tx: Tx, companyId: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const code = await nextNumber(tx, companyId, "EMP", 3);
    const taken = await tx.employee.findFirst({ where: { companyId, code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new Error("Could not find a free employee code");
}

/**
 * Every staff login (not worker, client or vendor) should have an employee record, for attendance, leave and payroll.
 * Creates the missing ones. Safe to run any time; does nothing when all are present.
 */
export async function ensureEmployees(companyId: string): Promise<number> {
  const missing = await db.user.findMany({
    where: { companyId, deletedAt: null, isActive: true, role: { notIn: ["WORKER", "CLIENT", "VENDOR"] }, employee: null },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { createdAt: "asc" },
  });
  if (!missing.length) return 0;
  await db.$transaction(async (tx) => {
    for (const u of missing) {
      const code = await nextEmployeeCode(tx, companyId);
      await tx.employee.create({ data: { companyId, userId: u.id, code, name: u.name, email: u.email, phone: u.phone } });
    }
  });
  return missing.length;
}
