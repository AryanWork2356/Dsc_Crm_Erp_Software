import type { RoleKey } from "@prisma/client";

/**
 * Permission keys are "<module>:<action>".
 * Actions: view, create, edit, delete, approve, export, manage.
 * Special sensitive keys: margins:view (cost/profit), salary:view, finance:view, audit:view.
 *
 * The matrix below is the single source of truth for RBAC (see docs/ROLES_AND_PERMISSIONS.md).
 * Data scoping (e.g. PM sees only own projects, client sees only own data) is enforced in queries
 * via lib/scope.ts, not here.
 */

export const MODULES = [
  "dashboard", "leads", "clients", "sitevisits", "quotations", "boq", "projects", "tasks",
  "purchase_requests", "purchase_orders", "vendors", "materials", "inventory", "workers",
  "contractors", "attendance", "employees", "leaves", "payroll", "invoices", "payments",
  "expenses", "vendor_bills", "approvals", "documents", "whatsapp", "support", "marketing",
  "reports", "settings", "team", "notifications",
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ["view", "create", "edit", "delete", "approve", "export", "manage"] as const;
export type Action = (typeof ACTIONS)[number];

export const SPECIAL = ["margins:view", "salary:view", "finance:view", "audit:view", "users:manage"] as const;

export type PermissionKey = `${Module}:${Action}` | (typeof SPECIAL)[number];

type Grant = Partial<Record<Module, Action[] | "*">>;

const ALL: Action[] = [...ACTIONS];
const RW: Action[] = ["view", "create", "edit"];
const RWX: Action[] = ["view", "create", "edit", "export"];
const R: Action[] = ["view"];

const everything: Grant = Object.fromEntries(MODULES.map((m) => [m, "*"])) as Grant;

const GRANTS: Record<RoleKey, { modules: Grant; special: string[] }> = {
  OWNER: {
    modules: everything,
    special: [...SPECIAL],
  },
  MANAGEMENT: {
    modules: { ...everything, settings: ["view"], team: R },
    special: ["margins:view", "finance:view", "audit:view", "salary:view"],
  },
  ADMIN: {
    modules: { ...everything, payroll: R },
    special: ["audit:view", "users:manage"],
  },
  SALES: {
    modules: { leaves: ["view", "create"],
      dashboard: R, leads: ALL.filter((a) => a !== "delete"), clients: RWX, sitevisits: RW,
      quotations: RWX, boq: R, projects: R, whatsapp: RW, documents: RW, support: R,
      marketing: R, approvals: R, notifications: R, reports: R,
    },
    special: [],
  },
  PROJECT_MANAGER: {
    modules: {
      dashboard: R, clients: R, sitevisits: RW, quotations: R, boq: RWX, projects: ["view", "edit", "export"],
      tasks: ALL, purchase_requests: RW, purchase_orders: R, vendors: R, materials: R, inventory: R,
      workers: R, contractors: R, attendance: RW, expenses: RW, documents: RW, approvals: ["view", "approve"],
      support: RW, whatsapp: R, reports: R, notifications: R, leaves: ["view", "create"],
    },
    special: ["margins:view"],
  },
  DESIGNER: {
    modules: { leaves: ["view", "create"],
      dashboard: R, clients: R, sitevisits: RW, quotations: RW, boq: RW, projects: R, tasks: RW,
      documents: RW, approvals: R, notifications: R,
    },
    special: [],
  },
  PROCUREMENT: {
    modules: { leaves: ["view", "create"],
      dashboard: R, projects: R, boq: R, purchase_requests: ALL.filter((a) => a !== "delete"),
      purchase_orders: ALL.filter((a) => a !== "delete"), vendors: ["view", "create", "edit", "export"],
      materials: RWX, inventory: ["view", "create", "export"], vendor_bills: RW, documents: RW,
      approvals: R, reports: R, notifications: R, whatsapp: R,
    },
    special: [],
  },
  ACCOUNTS: {
    modules: { leaves: ["view", "create"],
      dashboard: R, clients: R, projects: R, quotations: R, boq: R, invoices: ALL, payments: ALL,
      expenses: ALL, vendor_bills: ALL, vendors: R, purchase_orders: R, workers: R, attendance: R,
      payroll: R, documents: RW, approvals: ["view", "approve"], reports: ["view", "export"],
      notifications: R,
    },
    special: ["finance:view", "margins:view"],
  },
  HR: {
    modules: {
      dashboard: R, employees: ALL, leaves: ALL, payroll: ALL, attendance: ALL, workers: ALL,
      contractors: RW, documents: RW, approvals: ["view", "approve"], team: ["view", "manage"],
      notifications: R, reports: ["view", "export"],
    },
    special: ["salary:view"],
  },
  STORE: {
    modules: { leaves: ["view", "create"],
      dashboard: R, materials: RWX, inventory: ALL.filter((a) => a !== "delete"), purchase_orders: R,
      projects: R, documents: R, notifications: R, reports: R,
    },
    special: [],
  },
  SITE_ENGINEER: {
    modules: { expenses: ["view", "create"], leaves: ["view", "create"],
      dashboard: R, projects: R, tasks: RW, boq: R, attendance: RW, workers: R, inventory: ["view", "create"],
      materials: R, purchase_requests: RW, sitevisits: RW, documents: RW, support: RW, notifications: R,
    },
    special: [],
  },
  SITE_SUPERVISOR: {
    modules: { expenses: ["view", "create"], leaves: ["view", "create"],
      dashboard: R, projects: R, tasks: RW, attendance: RW, workers: R, inventory: ["view", "create"],
      purchase_requests: RW, documents: RW, notifications: R,
    },
    special: [],
  },
  WORKER: { modules: { tasks: ["view", "edit"], attendance: ["view", "create"], notifications: R }, special: [] },
  VENDOR: { modules: { purchase_orders: R, documents: R, notifications: R }, special: [] },
  CLIENT: { modules: { projects: R, quotations: R, invoices: R, payments: R, documents: R, support: R, notifications: R }, special: [] },
};

function expand(g: Grant): Set<string> {
  const out = new Set<string>();
  for (const [mod, acts] of Object.entries(g)) {
    const list = acts === "*" ? ALL : (acts as Action[]);
    for (const a of list) out.add(`${mod}:${a}`);
  }
  return out;
}

const CACHE = new Map<RoleKey, Set<string>>();

export function permissionsFor(role: RoleKey): Set<string> {
  let s = CACHE.get(role);
  if (!s) {
    const g = GRANTS[role];
    s = expand(g.modules);
    g.special.forEach((p) => s!.add(p));
    CACHE.set(role, s);
  }
  return s;
}

export function can(role: RoleKey, perm: PermissionKey): boolean {
  return permissionsFor(role).has(perm);
}

export const STAFF_ROLES: RoleKey[] = [
  "OWNER", "MANAGEMENT", "ADMIN", "SALES", "PROJECT_MANAGER", "DESIGNER", "PROCUREMENT",
  "ACCOUNTS", "HR", "STORE", "SITE_ENGINEER", "SITE_SUPERVISOR",
];

export const isPortalRole = (r: RoleKey) => r === "CLIENT" || r === "VENDOR";
export const isWorkerRole = (r: RoleKey) => r === "WORKER";
/** Roles that see every project (others see only projects they are assigned to) */
export const SEES_ALL_PROJECTS: RoleKey[] = ["OWNER", "MANAGEMENT", "ADMIN", "ACCOUNTS", "PROCUREMENT", "STORE", "HR"];

export const ROLE_LABELS: Record<RoleKey, string> = {
  OWNER: "Owner / Super Admin",
  MANAGEMENT: "Management / Director",
  ADMIN: "Admin",
  SALES: "Sales",
  PROJECT_MANAGER: "Project Manager",
  DESIGNER: "Designer",
  PROCUREMENT: "Procurement",
  ACCOUNTS: "Accounts / Finance",
  HR: "HR",
  STORE: "Store / Inventory",
  SITE_ENGINEER: "Site Engineer",
  SITE_SUPERVISOR: "Site Supervisor",
  WORKER: "Worker",
  VENDOR: "Vendor",
  CLIENT: "Client",
};

/** Used by docs + the Settings → Roles screen */
export function permissionMatrix() {
  const roles = Object.keys(GRANTS) as RoleKey[];
  return roles.map((r) => ({ role: r, label: ROLE_LABELS[r], permissions: [...permissionsFor(r)].sort() }));
}
