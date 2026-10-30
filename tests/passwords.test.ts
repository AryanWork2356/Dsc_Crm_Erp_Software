import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { passwordProblem } from "@/lib/password-rules";
import { fullLoginId, givenName, issuedPassword, loginIdFor, shortLoginId } from "@/lib/issued-password";
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

describe("passwords and login IDs the company gives out", () => {
  it("a password is four random digits, never an obvious one", () => {
    expect(givenName("Gopal Sharma")).toBe("Gopal");
    expect(givenName("Mohd. Shamshad Alam")).toBe("Shamshad");
    expect(givenName("Mohd Kaif")).toBe("Kaif");
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const p = issuedPassword("Krishna Maurya");
      expect(p).toMatch(/^\d{4}$/);
      expect(["0000", "1111", "1234", "4321", "9999"]).not.toContain(p);
      seen.add(p);
    }
    expect(seen.size).toBeGreaterThan(250); // random, not the same few
  });

  it("a login ID is first name, a dot and the first letter of the surname; a clash adds the next surname letter", () => {
    const taken = new Set<string>();
    expect(loginIdFor("Aryan Shetty", taken)).toBe("aryan.s@dscinterior.com");
    expect(loginIdFor("Gopal Sharma", taken)).toBe("gopal.s@dscinterior.com");
    expect(loginIdFor("Gopal Shukla", taken)).toBe("gopal.sh@dscinterior.com");
    expect(loginIdFor("Gopal Shah", taken)).toBe("gopal.sha@dscinterior.com");
    expect(loginIdFor("Gopal Shah", taken)).toBe("gopal.shah@dscinterior.com");
    expect(loginIdFor("Gopal Shah", taken)).toBe("gopal.shah2@dscinterior.com"); // letters used up: a number
    expect(loginIdFor("Mohd. Shamshad Alam", new Set())).toBe("shamshad.a@dscinterior.com");
    expect(loginIdFor("Arya", new Set())).toBe("arya@dscinterior.com");
  });

  it("people type name.initial@dsc (or without @dsc); it is shown the same short way", () => {
    expect(fullLoginId("Aryan.S@dsc")).toBe("aryan.s@dscinterior.com");
    expect(fullLoginId("  aryan.s  ")).toBe("aryan.s@dscinterior.com");
    expect(fullLoginId("aryan.s@dscinterior.com")).toBe("aryan.s@dscinterior.com");
    expect(fullLoginId("pm@dsc.demo")).toBe("pm@dsc.demo");
    expect(shortLoginId("aryan.s@dscinterior.com")).toBe("aryan.s@dsc");
    expect(shortLoginId("pm@dsc.demo")).toBe("pm@dsc.demo");
  });

  it("are accepted at sign-in, and nobody is sent to change them", async () => {
    const { email } = await newUser("SITE_SUPERVISOR", false);
    const pw = issuedPassword("Krishna Maurya");
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
    expect((await requestPasswordReset(undefined, fd({ email: "   " })))?.error).toMatch(/login ID/);
    expect(await requestPasswordReset(undefined, fd({ email: u.email.split("@")[0] }))).toEqual({ done: true }); // the short ID works here too
  });

  it("the Admin resets it: a password in the company style is made, nobody must change it, and the request is cleared", async () => {
    const { u } = await newUser("SITE_SUPERVISOR", false);
    await db.user.update({ where: { id: u.id }, data: { resetRequestedAt: new Date() } });
    await loginAs("admin@dsc.demo");
    const r = await resetPassword(u.id, fd({}));
    expect(r.ok).toBe(true);
    const msg = r.ok ? r.message ?? "" : "";
    const temp = /: (\S+)\s/.exec(msg)?.[1] ?? "";
    expect(temp).toMatch(/^\d{4}$/); // four random digits
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

describe("sign-in with the short ID, and the lock after wrong passwords", () => {
  it("the short ID works, and so does the full one", async () => {
    const { u } = await newUser("SITE_SUPERVISOR", false);
    const short = u.email.split("@")[0];
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash("Pwt@42", 4) } });
    expect(await redirected(login(undefined, fd({ email: short, password: "Pwt@42" })))).toContain("NEXT_REDIRECT");
    expect(await redirected(login(undefined, fd({ email: u.email, password: "Pwt@42" })))).toContain("NEXT_REDIRECT");
  });

  it("5 wrong passwords lock the login for 15 minutes, the Owner is told, and the right password then waits", async () => {
    const { u, email } = await newUser("SITE_SUPERVISOR", false);
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash("Pwt@42", 4) } });
    for (let i = 1; i <= 4; i++) {
      const r = await login(undefined, fd({ email, password: `wrong${i}` }));
      expect(r?.error).toMatch(/Incorrect/);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(4);
    await login(undefined, fd({ email, password: "wrong5" })); // the 5th
    const locked = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(locked.lockedUntil && locked.lockedUntil.getTime() > Date.now()).toBe(true);
    const owner = await db.user.findFirstOrThrow({ where: { role: "OWNER", isActive: true } });
    expect(await db.notification.count({ where: { userId: owner.id, title: { contains: `Login locked: ${u.name}` } } })).toBeGreaterThan(0);
    // even the right password is refused while locked
    expect((await login(undefined, fd({ email, password: "Pwt@42" })))?.error).toMatch(/locked/);
    // after the time passes it works again, and the count starts over
    await db.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect(await redirected(login(undefined, fd({ email, password: "Pwt@42" })))).toContain("NEXT_REDIRECT");
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(0);
  });
});
