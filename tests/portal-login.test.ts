import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createPortalLogin } from "@/app/(app)/settings/actions";

beforeEach(() => logout());

describe("portal logins for clients and vendors", () => {
  it("the Owner creates a client login linked to that client, and can reset it", async () => {
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    await db.user.deleteMany({ where: { email: "portal.test@acme.test" } });
    await loginAs("owner@dsc.demo");
    expect((await createPortalLogin("CLIENT", client.id, fd({ email: "Portal.Test@Acme.test", password: "Secret@123" }))).ok).toBe(true);
    const u = await db.user.findFirstOrThrow({ where: { email: "portal.test@acme.test" } });
    expect(u).toMatchObject({ role: "CLIENT", clientId: client.id, isActive: true });
    // same client again: updates the one login, no second user
    expect((await createPortalLogin("CLIENT", client.id, fd({ email: "portal.test@acme.test", password: "NewSecret@1" }))).ok).toBe(true);
    expect(await db.user.count({ where: { role: "CLIENT", clientId: client.id, email: "portal.test@acme.test" } })).toBe(1);
    await db.user.deleteMany({ where: { email: "portal.test@acme.test" } });
  });

  it("works for vendors, and refuses a short password, a bad email or an email already in use", async () => {
    const vendor = await db.vendor.findFirstOrThrow({ where: { deletedAt: null } });
    await db.user.deleteMany({ where: { email: "vendor.portal@test.test" } });
    await loginAs("admin@dsc.demo");
    expect((await createPortalLogin("VENDOR", vendor.id, fd({ email: "vendor.portal@test.test", password: "short" }))).ok).toBe(false);
    expect((await createPortalLogin("VENDOR", vendor.id, fd({ email: "not-an-email", password: "LongEnough@1" }))).ok).toBe(false);
    expect((await createPortalLogin("VENDOR", vendor.id, fd({ email: "owner@dsc.demo", password: "LongEnough@1" }))).ok).toBe(false);
    expect((await createPortalLogin("VENDOR", vendor.id, fd({ email: "vendor.portal@test.test", password: "LongEnough@1" }))).ok).toBe(true);
    expect(await db.user.findFirstOrThrow({ where: { email: "vendor.portal@test.test" } })).toMatchObject({ role: "VENDOR", vendorId: vendor.id });
    expect((await createPortalLogin("VENDOR", "does-not-exist", fd({ email: "x@test.test", password: "LongEnough@1" }))).ok).toBe(false);
    await db.user.deleteMany({ where: { email: "vendor.portal@test.test" } });
  });

  it("only people who manage users can do it", async () => {
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    for (const email of ["sales@dsc.demo", "hr@dsc.demo", "director@dsc.demo"]) {
      await loginAs(email);
      expect((await createPortalLogin("CLIENT", client.id, fd({ email: "nope@test.test", password: "LongEnough@1" }))).ok).toBe(false);
    }
    logout();
    expect((await createPortalLogin("CLIENT", client.id, fd({ email: "nope@test.test", password: "LongEnough@1" }))).ok).toBe(false);
    expect(await db.user.count({ where: { email: "nope@test.test" } })).toBe(0);
  });
});
