import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createUser } from "@/app/(app)/settings/actions";
import { createEmployee } from "@/app/(app)/hr/actions";
import { ensureEmployees } from "@/lib/employee-code";

beforeEach(() => logout());

describe("employee codes never collide", () => {
  it("Add user then Add employee after the counter was reset, as on a freshly cleared company", async () => {
    const company = await db.company.findFirstOrThrow();
    await db.employee.deleteMany({ where: { email: { in: ["new.staff@test.test", "second.person@test.test"] } } });
    await db.user.deleteMany({ where: { email: "new.staff@test.test" } });
    const used = (await db.employee.findMany({ where: { companyId: company.id }, select: { code: true } })).map((e) => e.code);
    await db.sequence.deleteMany({ where: { companyId: company.id, key: "EMP" } }); // the counter starts again from 1

    await loginAs("owner@dsc.demo");
    expect((await createUser(fd({ name: "New Staff", email: "new.staff@test.test", role: "SITE_SUPERVISOR", password: "LongEnough@1" }))).ok).toBe(true);
    const r = await createEmployee(fd({ name: "Second Person", email: "second.person@test.test" }));
    expect(r.ok).toBe(true);

    const codes = (await db.employee.findMany({ where: { companyId: company.id }, select: { code: true } })).map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length); // no duplicates anywhere
    const mine = await db.employee.findMany({ where: { email: { in: ["new.staff@test.test", "second.person@test.test"] } } });
    expect(mine).toHaveLength(2);
    for (const e of mine) expect(used).not.toContain(e.code);
  });

  it("gives every staff login without an employee record one, and leaves workers and portals alone", async () => {
    const company = await db.company.findFirstOrThrow();
    await db.user.deleteMany({ where: { email: "no.record@test.test" } });
    const u = await db.user.create({ data: { companyId: company.id, email: "no.record@test.test", name: "No Record", role: "STORE", passwordHash: "x" } }); // a login with no employee record
    const portal = await db.user.count({ where: { role: { in: ["CLIENT", "VENDOR", "WORKER"] }, employee: { isNot: null } } });
    expect(portal).toBe(0);
    const made = await ensureEmployees(company.id);
    expect(made).toBeGreaterThanOrEqual(1);
    const e = await db.employee.findFirstOrThrow({ where: { userId: u.id } });
    expect(e.name).toBe(u.name);
    expect(await ensureEmployees(company.id)).toBe(0); // nothing left to do
    expect(await db.user.count({ where: { role: { in: ["CLIENT", "VENDOR", "WORKER"] }, employee: { isNot: null } } })).toBe(0);
    await db.employee.deleteMany({ where: { userId: u.id } });
    await db.user.delete({ where: { id: u.id } });
  });
});
