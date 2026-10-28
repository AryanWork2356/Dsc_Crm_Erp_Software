import "server-only";
import type { RoleKey } from "@prisma/client";
import { db } from "./db";
import type { Opt } from "./enums";

/** Dropdown options for related entities. Always scoped to the company. */
/** The old test logins ("Test login: Owner" …) are for trying the app, not real people: they never appear in a list to choose from. */
export const TEST_LOGIN_PREFIX = "Test login:";

export async function userOptions(companyId: string, roles?: RoleKey[], includeTest = false): Promise<Opt[]> {
  const rows = await db.user.findMany({
    where: { companyId, isActive: true, deletedAt: null, ...(includeTest ? {} : { NOT: { name: { startsWith: TEST_LOGIN_PREFIX } } }), ...(roles ? { role: { in: roles } } : { role: { notIn: ["CLIENT", "VENDOR", "WORKER"] } }) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

export async function clientOptions(companyId: string): Promise<Opt[]> {
  const rows = await db.client.findMany({ where: { companyId, deletedAt: null }, select: { id: true, name: true, companyName: true }, orderBy: { name: "asc" }, take: 1000 });
  return rows.map((r) => ({ value: r.id, label: r.companyName ? `${r.name} (${r.companyName})` : r.name }));
}

export async function projectOptions(companyId: string, where: object = {}): Promise<Opt[]> {
  const rows = await db.project.findMany({ where: { companyId, deletedAt: null, ...where }, select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" }, take: 1000 });
  return rows.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }));
}

export async function vendorOptions(companyId: string): Promise<Opt[]> {
  const rows = await db.vendor.findMany({ where: { companyId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

export const SALES_ROLES: RoleKey[] = ["SALES", "OWNER", "MANAGEMENT", "ADMIN"];
/** The "Project manager" list shows project managers only. */
export const PM_ROLES: RoleKey[] = ["PROJECT_MANAGER"];
/** One list for the person on site: site supervisors and site engineers are the same job here. */
export const SITE_ROLES: RoleKey[] = ["SITE_SUPERVISOR", "SITE_ENGINEER"];
export const DESIGNER_ROLES: RoleKey[] = ["DESIGNER"];
