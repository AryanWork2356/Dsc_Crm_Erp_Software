import { describe, it, expect } from "vitest";
import type { RoleKey } from "@prisma/client";
import { NAV, SIMPLE_MENU, menuFor } from "@/lib/nav";
import { can } from "@/lib/permissions";

const allHrefs = new Set(NAV.flatMap((g) => [g.href, ...g.items.map((i) => i.href)]).filter(Boolean) as string[]);
const visible = (role: RoleKey) => menuFor(role, (p) => can(role, p)).flatMap((g) => (g.href ? [g.href] : g.items.map((i) => i.href)));

describe("lean menus per role", () => {
  it("every menu entry in a role's list is a real page (no typos)", () => {
    for (const [role, list] of Object.entries(SIMPLE_MENU)) for (const h of list!) expect(allHrefs.has(h), `${role}: ${h}`).toBe(true);
  });

  it("a menu never shows something the role's permissions do not allow", () => {
    for (const role of Object.keys(SIMPLE_MENU) as RoleKey[]) {
      const full = new Set(menuFor("OWNER", () => true).flatMap((g) => (g.href ? [g.href] : g.items.map((i) => i.href))));
      for (const h of visible(role)) expect(full.has(h)).toBe(true);
    }
  });

  it("a site supervisor sees only the jobs of a supervisor", () => {
    const m = visible("SITE_SUPERVISOR");
    expect(m).toEqual(expect.arrayContaining(["/actions", "/site-reports", "/procurement/requests", "/inventory/receipts", "/workforce/attendance", "/transfers", "/extra-work"]));
    expect(m.length).toBeLessThanOrEqual(16); // 13 jobs + Actions & Blockers + Manpower + Waste
    for (const hidden of ["/dashboard", "/finance/invoices", "/finance/bills", "/hr/payroll", "/crm/leads", "/inventory/movements", "/settings/team", "/scorecards", "/time-limits"]) expect(m).not.toContain(hidden);
  });

  it("each role gets a clearly shorter menu than its permissions would allow, and the owner keeps everything", () => {
    const owner = menuFor("OWNER", (p) => can("OWNER", p)).flatMap((g) => (g.href ? [g.href] : g.items.map((i) => i.href)));
    expect(owner.length).toBeGreaterThan(55);
    for (const role of ["SITE_SUPERVISOR", "SITE_ENGINEER", "PROJECT_MANAGER", "SALES", "DESIGNER", "PROCUREMENT", "STORE", "ACCOUNTS", "HR", "ADMIN", "MANAGEMENT"] as RoleKey[]) {
      const lean = visible(role).length;
      const entries: { perm?: (typeof NAV)[number]["perm"] }[] = NAV.flatMap((g) => (g.href ? [{ perm: g.perm }] : g.items.map((i) => ({ perm: i.perm }))));
      const allowed = entries.filter((i) => !i.perm || can(role, i.perm)).length;
      expect(lean, role).toBeLessThan(allowed);
      expect(lean, role).toBeGreaterThanOrEqual(8);
    }
  });

  it("finance menus go only to finance roles; payroll only to HR and directors", () => {
    for (const role of ["SITE_SUPERVISOR", "SITE_ENGINEER", "SALES", "DESIGNER", "STORE", "PROJECT_MANAGER"] as RoleKey[]) expect(visible(role).some((h) => h.startsWith("/finance/inv") || h === "/finance/payments" || h === "/hr/payroll"), role).toBe(false);
    expect(visible("ACCOUNTS")).toContain("/finance/invoices");
    expect(visible("HR")).toContain("/hr/payroll");
  });
});
