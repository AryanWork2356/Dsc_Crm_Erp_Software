import { describe, it, expect, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { setupCompany, validateSetup, type SetupOptions } from "../scripts/lib/setup";

const good: SetupOptions = { companyName: "Firstrun Interiors Pvt Ltd", gstin: "27AAECD2813K1ZP", ownerName: "Test Owner", ownerEmail: "Owner@FirstRun.example", password: "a-long-strong-pass" };

afterAll(async () => {
  const c = await db.company.findUnique({ where: { slug: "firstrun-interiors-pvt-ltd" } });
  if (!c) return;
  await db.employee.deleteMany({ where: { companyId: c.id } });
  await db.user.deleteMany({ where: { companyId: c.id } });
  await db.sequence.deleteMany({ where: { companyId: c.id } });
  await db.companySettings.deleteMany({ where: { companyId: c.id } });
  await db.company.delete({ where: { id: c.id } });
});

describe("first-run setup for a real installation", () => {
  it("checks the details before touching anything", () => {
    expect(validateSetup(good)).toEqual([]);
    expect(validateSetup({ ...good, companyName: " " })).toHaveLength(1);
    expect(validateSetup({ ...good, ownerEmail: "nope" })[0]).toMatch(/email/i);
    expect(validateSetup({ ...good, password: "short" })[0]).toMatch(/10 characters/);
    expect(validateSetup({ ...good, password: "Demo@1234567" })[0]).toMatch(/stronger/);
    expect(validateSetup({ ...good, gstin: "123" })[0]).toMatch(/GSTIN/);
  });

  it("creates the company, its settings and the Owner – with no demo data", async () => {
    const r = await setupCompany(db, good);
    const settings = await db.companySettings.findUniqueOrThrow({ where: { companyId: r.companyId } });
    expect(settings).toMatchObject({ legalName: "Firstrun Interiors Pvt Ltd", gstin: "27AAECD2813K1ZP" });
    expect(settings.defaultPaymentTerms).toMatch(/50% advance/); // sensible defaults still apply
    const owner = await db.user.findUniqueOrThrow({ where: { id: r.ownerId } });
    expect(owner).toMatchObject({ role: "OWNER", email: "owner@firstrun.example", isActive: true });
    expect(await bcrypt.compare(good.password, owner.passwordHash)).toBe(true);
    expect(owner.passwordHash).not.toContain(good.password);
    for (const n of [await db.lead.count({ where: { companyId: r.companyId } }), await db.project.count({ where: { companyId: r.companyId } }), await db.client.count({ where: { companyId: r.companyId } }), await db.invoice.count({ where: { companyId: r.companyId } })]) expect(n).toBe(0);
    expect(await db.user.count({ where: { companyId: r.companyId } })).toBe(1);
  });

  it("will not run twice on a company that already has users", async () => {
    await expect(setupCompany(db, { ...good, ownerEmail: "someone.else@firstrun.example" })).rejects.toThrow(/already set up/);
    expect(await db.user.count({ where: { email: "someone.else@firstrun.example" } })).toBe(0);
  });
});
