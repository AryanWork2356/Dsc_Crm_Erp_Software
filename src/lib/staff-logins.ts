import "server-only";
import type { RoleKey } from "@prisma/client";
import { db } from "./db";
import { loginIdFor } from "./issued-password";

/**
 * DSC's people and their roles (as decided on 31 Oct 2026), matched by first name:
 *   directors: Harendra (Harinder), Rupesh, Dinesh, Satish, Gopal   (those who already have full access keep it)
 *   admins: Shreya, Shravani · HR: Sakshi · designer: Bipin · accounts: Rohit, Pramod · Aryan: full access (host)
 *   everyone else on the staff: Project Coordinator
 * Test logins (@dsc.demo, "Test login: …") and client, vendor and worker logins are never touched.
 */
const BY_FIRST_NAME: Record<string, RoleKey> = {
  harendra: "MANAGEMENT", harinder: "MANAGEMENT", rupesh: "MANAGEMENT", dinesh: "MANAGEMENT", satish: "MANAGEMENT", gopal: "MANAGEMENT",
  shreya: "ADMIN", shravani: "ADMIN", sharavni: "ADMIN",
  sakshi: "HR",
  bipin: "DESIGNER",
  rohit: "ACCOUNTS", pramod: "ACCOUNTS",
  aryan: "OWNER",
};

const firstName = (name: string) => {
  const w = name.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (w[0]?.toLowerCase() === "mohd" && w.length > 1) w.shift();
  return (w[0] ?? "").toLowerCase();
};

export function roleFor(name: string, current: RoleKey): RoleKey {
  const r = BY_FIRST_NAME[firstName(name)] ?? "SITE_SUPERVISOR";
  return r === "MANAGEMENT" && current === "OWNER" ? "OWNER" : r; // a director who already has full access keeps it
}

export type StaffLoginRow = { userId: string; name: string; oldRole: RoleKey; newRole: RoleKey; oldId: string; newId: string };

/** Who gets which role and login ID. Changes nothing. */
export async function planStaffLogins(companyId: string): Promise<StaffLoginRow[]> {
  const users = await db.user.findMany({ where: { companyId, deletedAt: null }, select: { id: true, name: true, email: true, role: true, isActive: true }, orderBy: { name: "asc" } });
  const staff = users.filter((u) => u.isActive && !["CLIENT", "VENDOR", "WORKER"].includes(u.role) && !u.name.startsWith("Test login:") && !u.email.toLowerCase().endsWith("@dsc.demo"));
  const mine = new Set(staff.map((u) => u.id));
  const taken = new Set(users.filter((u) => !mine.has(u.id)).map((u) => u.email.toLowerCase()));
  return staff.map((u) => ({ userId: u.id, name: u.name, oldRole: u.role, newRole: roleFor(u.name, u.role), oldId: u.email, newId: loginIdFor(u.name, taken) }));
}
