import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { passwordProblem } from "@/lib/password-rules";
import { givenName, issuedPassword } from "@/lib/issued-password";
import { changeMyPassword } from "@/app/change-password/actions";
import { requestPasswordReset } from "@/app/forgot-password/actions";
import { login } from "@/app/login/actions";
import { resetPassword, createUser } from "@/app/(app)/settings/actions";

beforeEach(() => logout());

let seq = 0;
const tag = () => `${Date.now().toString(36)}${seq++}`;

async function newUser(role: "SITE_SUPERVISOR" | "PROJECT_MANAGER" = "SITE_SUPERVISOR", must = true) {
  const company = await db.company.findFirstOrThrow();
  const email = `pw-${tag()}@dscinterior.com`;
  const u = await db.user.create({ data: { companyId: company.id, email, name: `Pw tester ${tag()}`, role, passwordHash: await bcrypt.hash("Given1234x", 4), mustChangePassword: must } });
  return { u, email };
}
const redirected = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return String((e as { digest?: string }).digest ?? ""); }
  return null;
};

describe("password rules", () => {
  it("asks for 8+ characters with letters and numbers, and refuses easy ones", () => {
    expect(passwordProblem("abc12", "x@y.com")).toMatch(/8 characters/);
    expect(passwordProblem("abcdefgh", "x@y.com")).toMatch(/letters and numbers/);
    expect(passwordProblem("Demo@1234", "x@y.com")).toMatch(/easy to guess/);
    expect(passwordProblem("Rakesh2026ab", "rakesh.yadav@dscinterior.com")).toBe(null); // not the whole local part
    expect(passwordProblem("rakesh.yadav99", "rakesh.yadav@dscinterior.com")).toMatch(/name or login/);
    expect(passwordProblem("Given1234x", "a@b.com", "Given1234x")).toMatch(/different/);
    expect(passwordProblem("Blue7Kitchen", "a@b.com", "Given1234x")).toBe(null);
  });
});

describe("passwords the company gives out", () => {
  it("are the first name, then @, then a number; money and management roles get a longer number and a !", () => {
    expect(givenName("Gopal Sharma")).toBe("Gopal");
    expect(givenName("Mohd. Shamshad Alam")).toBe("Shamshad");
    expect(givenName("Mohd Kaif")).toBe("Kaif");
    expect(givenName("Test login: Project Manager")).toBe("ProjectManager");
    for (let i = 0; i < 50; i++) {
      expect(issuedPassword("Krishna Maurya", "SITE_SUPERVISOR")).toMatch(/^Krishna@\d{5}$/);
      expect(issuedPassword("Dinesh Sharma", "OWNER")).toMatch(/^Dinesh@\d{6}!$/);
      expect(issuedPassword("Sakshi Singh", "HR")).toMatch(/^Sakshi@\d{6}!$/);
      expect(issuedPassword("Shravani Bhalerkar", "ACCOUNTS")).toMatch(/^Shravani@\d{6}!$/);
    }
    expect(new Set(Array.from({ length: 30 }, () => issuedPassword("Amit Jha", "SITE_SUPERVISOR"))).size).toBeGreaterThan(20); // the number is random
  });

  it("are accepted at sign-in, and nobody is sent to change them", async () => {
    const { email } = await newUser("SITE_SUPERVISOR", false);
    const pw = issuedPassword("Krishna Maurya", "SITE_SUPERVISOR");
    await db.user.updateMany({ where: { email }, data: { passwordHash: await bcrypt.hash(pw, 4) } });
    const r = await redirected(login(undefined, fd({ email, password: pw })));
    expect(r).toContain("NEXT_REDIRECT");
    expect(r).not.toContain("change-password");
  });

  it("people can not set their own: only the Admin changes a password", async () => {
    const { u, email } = await newUser("PROJECT_MANAGER", false);
    await loginAs(email);
    const r = await changeMyPassword(undefined, fd({ current: "Given1234x", next: "Blue7Kitchen", again: "Blue7Kitchen" }));
    expect(r?.error).toMatch(/Admin/);
    expect(await bcrypt.compare("Given1234x", (await db.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash)).toBe(true);
  });
});

describe("choosing your own password (kept for a forced change; off for normal use)", () => {
  it("someone with a given password is sent to choose their own, and can then sign in normally", async () => {
    const { u, email } = await newUser();
    const r = await redirected(login(undefined, fd({ email, password: "Given1234x" })));
    expect(r).toContain("/change-password");

    await loginAs(email);
    expect((await changeMyPassword(undefined, fd({ current: "wrong", next: "Blue7Kitchen", again: "Blue7Kitchen" })))?.error).toMatch(/current password/);
    expect((await changeMyPassword(undefined, fd({ current: "Given1234x", next: "Blue7Kitchen", again: "Blue7Kitchen2" })))?.error).toMatch(/not the same/);
    expect((await changeMyPassword(undefined, fd({ current: "Given1234x", next: "short1", again: "short1" })))?.error).toMatch(/8 characters/);
    expect(await redirected(changeMyPassword(undefined, fd({ current: "Given1234x", next: "Blue7Kitchen", again: "Blue7Kitchen" })))).toMatch(/NEXT_REDIRECT/);

    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.mustChangePassword).toBe(false);
    expect(after.passwordChangedAt).not.toBeNull();
    expect(await bcrypt.compare("Blue7Kitchen", after.passwordHash)).toBe(true);
    expect(await bcrypt.compare("Given1234x", after.passwordHash)).toBe(false);
    logout();
    const again = await redirected(login(undefined, fd({ email, password: "Blue7Kitchen" })));
    expect(again).not.toContain("/change-password");
    expect(again).toContain("NEXT_REDIRECT");
  });
});

describe("forgot password", () => {
  it("tells the Owner and Admin, and gives the same answer whether or not the ID exists", async () => {
    const { u, email } = await newUser("SITE_SUPERVISOR", false);
    const known = await requestPasswordReset(undefined, fd({ email }));
    const unknown = await requestPasswordReset(undefined, fd({ email: `nobody-${tag()}@dscinterior.com` }));
    expect(known).toEqual({ done: true });
    expect(unknown).toEqual({ done: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).resetRequestedAt).not.toBeNull();
    const owner = await db.user.findFirstOrThrow({ where: { role: "OWNER", isActive: true } });
    expect(await db.notification.count({ where: { userId: owner.id, title: { contains: "Password reset asked" } } })).toBeGreaterThan(0);
    expect((await requestPasswordReset(undefined, fd({ email: "not-an-email" })))?.error).toMatch(/login ID/);
  });

  it("the Admin resets it: a password in the company style is made, nobody must change it, and the request is cleared", async () => {
    const { u } = await newUser("SITE_SUPERVISOR", false);
    await db.user.update({ where: { id: u.id }, data: { resetRequestedAt: new Date() } });
    await loginAs("admin@dsc.demo");
    const r = await resetPassword(u.id, fd({}));
    expect(r.ok).toBe(true);
    const msg = r.ok ? r.message ?? "" : "";
    const temp = /: (\S+)\s/.exec(msg)?.[1] ?? "";
    expect(temp).toMatch(/^Pw@\d{5}$/); // first name of "Pw tester …", then @ and a number
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.mustChangePassword).toBe(false);
    expect(after.resetRequestedAt).toBeNull();
    expect(await bcrypt.compare(temp, after.passwordHash)).toBe(true);
  });

  it("only people who manage users can reset someone else's password", async () => {
    const { u } = await newUser("SITE_SUPERVISOR", false);
    await loginAs("supervisor@dsc.demo");
    expect((await resetPassword(u.id, fd({ password: "Whatever123" }))).ok).toBe(false);
  });

  it("a person added by the Admin signs in with the password the Admin gave and is not asked to change it", async () => {
    await loginAs("admin@dsc.demo");
    const email = `added-${tag()}@dscinterior.com`;
    const r = await createUser(fd({ name: "Added Person", email, role: "SITE_SUPERVISOR", password: "Given1234x" }));
    expect(r.ok).toBe(true);
    expect((await db.user.findFirstOrThrow({ where: { email } })).mustChangePassword).toBe(false);
  });
});
