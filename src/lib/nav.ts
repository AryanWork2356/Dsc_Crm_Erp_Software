import type { RoleKey } from "@prisma/client";
import type { PermissionKey } from "./permissions";
import { featureOff } from "./features";

export type NavItem = { label: string; href: string; perm?: PermissionKey };
export type NavGroup = { label?: string; icon: string; items: NavItem[]; href?: string; perm?: PermissionKey };

/**
 * Sidebar structure. Items are only listed once their page exists (no dead navigation).
 * Visibility is filtered by the user's permissions at render time.
 */
export const NAV: NavGroup[] = [
  { label: "Dashboard", icon: "layout-dashboard", href: "/dashboard", items: [], perm: "dashboard:view" },
  {
    label: "My Work",
    icon: "check-square",
    items: [
      { label: "Today's Plan", href: "/today", perm: "tasks:view" },
      { label: "Actions & Blockers", href: "/actions", perm: "actions:view" },
      { label: "Approvals", href: "/approvals", perm: "approvals:view" },
      { label: "Time Limits", href: "/time-limits", perm: "dashboard:view" },
      { label: "Notifications", href: "/notifications", perm: "notifications:view" },
    ],
  },
  {
    label: "Clients",
    icon: "users",
    items: [
      { label: "Clients", href: "/crm/clients", perm: "clients:view" },
      { label: "Leads", href: "/crm/leads", perm: "leads:view" },
      { label: "Follow-ups", href: "/crm/follow-ups", perm: "leads:view" },
      { label: "Site Visits", href: "/crm/site-visits", perm: "sitevisits:view" },
    ],
  },
  {
    label: "Sales",
    icon: "file-text",
    items: [
      { label: "Bill of Quantities", href: "/sales/boq", perm: "boq:view" },
      { label: "Quotations", href: "/sales/quotations", perm: "quotations:view" },
      { label: "Client rates", href: "/sales/rates", perm: "margins:view" },
    ],
  },
  {
    label: "Projects",
    icon: "folder-kanban",
    items: [
      { label: "All Projects", href: "/projects", perm: "projects:view" },
      { label: "Tasks", href: "/projects/tasks", perm: "tasks:view" },
      { label: "Daily Site Reports", href: "/site-reports", perm: "site_reports:view" },
      { label: "Extra Work", href: "/extra-work", perm: "extra_work:view" },
    ],
  },
  {
    label: "Workforce",
    icon: "hard-hat",
    items: [
      { label: "Manpower", href: "/resources", perm: "resources:view" },
      { label: "Attendance", href: "/workforce/attendance", perm: "attendance:view" },
      { label: "Workers", href: "/workforce/workers", perm: "workers:view" },
      { label: "Contractors", href: "/workforce/contractors", perm: "contractors:view" },
      { label: "Labour Cost", href: "/workforce/labour", perm: "salary:view" },
    ],
  },
  {
    label: "Closing & Quality",
    icon: "life-buoy",
    items: [
      { label: "Project Closure", href: "/closure", perm: "closure:view" },
      { label: "Scorecards", href: "/scorecards", perm: "scorecards:view" },
      { label: "Customer Support", href: "/support", perm: "support:view" },
    ],
  },
  {
    label: "Procurement",
    icon: "shopping-cart",
    items: [
      { label: "Material Needed", href: "/procurement/needs", perm: "purchase_requests:view" },
      { label: "Purchase Requests", href: "/procurement/requests", perm: "purchase_requests:view" },
      { label: "Purchase Orders", href: "/procurement/orders", perm: "purchase_orders:view" },
      { label: "Vendors", href: "/procurement/vendors", perm: "vendors:view" },
      { label: "Deliveries", href: "/procurement/deliveries", perm: "purchase_orders:view" },
    ],
  },
  {
    label: "Warehouse",
    icon: "boxes",
    items: [
      { label: "Stock", href: "/inventory/stock", perm: "inventory:view" },
      { label: "Materials", href: "/inventory/materials", perm: "materials:view" },
      { label: "Locations", href: "/inventory/locations", perm: "inventory:view" },
      { label: "Stock Ledger", href: "/inventory/movements", perm: "inventory:view" },
    ],
  },
  {
    label: "Site Material",
    icon: "boxes",
    items: [
      { label: "Material Receipts", href: "/inventory/receipts", perm: "inventory:view" },
      { label: "Issues & Returns", href: "/inventory/issues", perm: "inventory:view" },
      { label: "Waste & Reconciliation", href: "/inventory/waste", perm: "inventory:view" },
      { label: "Transfers", href: "/transfers", perm: "transfers:view" },
    ],
  },
  {
    label: "Client Billing",
    icon: "wallet",
    items: [
      { label: "Overview", href: "/finance", perm: "finance:view" },
      { label: "Company profit", href: "/finance/profit", perm: "margins:view" },
      { label: "Invoices", href: "/finance/invoices", perm: "invoices:view" },
      { label: "Payments Received", href: "/finance/payments", perm: "payments:view" },
      { label: "Receivables", href: "/finance/receivables", perm: "invoices:view" },
    ],
  },
  {
    label: "Vendor Payments",
    icon: "wallet",
    items: [
      { label: "Bills to Certify", href: "/bills-to-certify", perm: "bill_certification:view" },
      { label: "Vendor Bills", href: "/finance/bills", perm: "vendor_bills:view" },
      { label: "Payables", href: "/finance/payables", perm: "vendor_bills:view" },
      { label: "Expenses", href: "/finance/expenses", perm: "expenses:view" },
    ],
  },
  {
    label: "HR",
    icon: "user-cog",
    items: [
      { label: "Employees", href: "/hr/employees", perm: "employees:view" },
      { label: "Leave", href: "/hr/leaves", perm: "leaves:view" },
      { label: "Payroll", href: "/hr/payroll", perm: "salary:view" },
      { label: "Advances", href: "/hr/advances", perm: "salary:view" },
      { label: "My Payslips", href: "/hr/payslips", perm: "leaves:view" },
      { label: "Announcements", href: "/hr/announcements", perm: "notifications:view" },
    ],
  },
  {
    label: "Management",
    icon: "bar-chart",
    items: [
      { label: "Exceptions", href: "/exceptions", perm: "exceptions:view" },
      { label: "Key numbers", href: "/kpis", perm: "exceptions:view" },
      { label: "Director Reports", href: "/director-reports", perm: "finance:view" },
      { label: "Reports", href: "/reports", perm: "reports:view" },
    ],
  },
  { label: "Documents", icon: "folder-open", href: "/documents", items: [], perm: "documents:view" },
  {
    label: "Communication",
    icon: "message-circle",
    items: [
      { label: "WhatsApp", href: "/whatsapp", perm: "whatsapp:view" },
      { label: "Marketing", href: "/marketing", perm: "marketing:view" },
    ],
  },
  {
    label: "People & Company",
    icon: "settings",
    items: [
      { label: "Team & Users", href: "/settings/team", perm: "team:view" },
      { label: "Company Settings", href: "/settings/company", perm: "settings:view" },
      { label: "Roles & Permissions", href: "/settings/roles", perm: "settings:view" },
      { label: "Import Data", href: "/settings/import", perm: "settings:view" },
      { label: "Terms Templates", href: "/settings/terms", perm: "settings:view" },
      { label: "Audit Log", href: "/settings/audit", perm: "audit:view" },
    ],
  },
  {
    label: "Rules & Automation",
    icon: "timer",
    items: [
      { label: "Time Limit Rules", href: "/settings/time-limits", perm: "settings:manage" },
      { label: "Attendance Location", href: "/settings/attendance", perm: "settings:manage" },
      { label: "Automation", href: "/settings/automation", perm: "settings:manage" },
      { label: "WhatsApp Connection", href: "/settings/whatsapp", perm: "settings:manage" },
    ],
  },
];

/**
 * Lean menus. Roles are allowed to open more screens than they need day to day, but their MENU shows only the jobs
 * they actually do, and each job in ONE place: notifications are the bell, the day's work is Today's Plan, the crew count is in the
 * morning update, and the directors' boards (Exceptions, Key numbers, Time Limits) are for directors; everyone else works from Actions. This hides menu entries only –
 * what a role may open is still decided by the permission matrix and row scope. Add a role here to simplify its menu;
 * leave it out to show everything its permissions allow.
 */
const STAFF_COMMON = ["/actions", "/hr/leaves", "/hr/payslips", "/hr/announcements"];
const SITE_CORE = ["/today", "/site-reports", "/inventory/waste", "/projects", "/procurement/requests", "/inventory/receipts", "/workforce/attendance", "/transfers", "/extra-work", "/finance/expenses", ...STAFF_COMMON];
export const SIMPLE_MENU: Partial<Record<RoleKey, string[]>> = {
  SITE_SUPERVISOR: SITE_CORE,
  SITE_ENGINEER: [...SITE_CORE, "/crm/site-visits", "/sales/boq", "/inventory/stock", "/inventory/issues", "/support"],
  PROJECT_MANAGER: ["/dashboard", "/today", "/resources", "/inventory/waste", "/approvals", "/projects", "/site-reports", "/transfers", "/extra-work", "/bills-to-certify", "/closure", "/scorecards", "/sales/boq", "/sales/rates", "/procurement/needs", "/procurement/requests", "/procurement/orders", "/inventory/stock", "/workforce/attendance", "/finance/expenses", "/documents", "/support", "/reports", ...STAFF_COMMON],
  SALES: ["/dashboard", "/crm/leads", "/crm/follow-ups", "/crm/site-visits", "/crm/clients", "/sales/quotations", "/sales/boq", "/projects", "/whatsapp", "/reports", "/approvals", ...STAFF_COMMON],
  DESIGNER: ["/dashboard", "/today", "/crm/clients", "/crm/site-visits", "/sales/boq", "/sales/quotations", "/projects", "/documents", "/approvals", ...STAFF_COMMON],
  PROCUREMENT: ["/dashboard", "/inventory/waste", "/approvals", "/procurement/needs", "/procurement/requests", "/procurement/orders", "/procurement/vendors", "/procurement/deliveries", "/inventory/stock", "/inventory/materials", "/inventory/receipts", "/finance/bills", "/finance/payables", "/sales/boq", "/projects", "/site-reports", "/transfers", "/whatsapp", "/documents", "/reports", ...STAFF_COMMON],
  STORE: ["/dashboard", "/inventory/waste", "/inventory/stock", "/inventory/materials", "/inventory/receipts", "/inventory/issues", "/inventory/movements", "/inventory/locations", "/procurement/orders", "/procurement/deliveries", "/transfers", "/site-reports", "/projects", ...STAFF_COMMON],
  ACCOUNTS: ["/dashboard", "/actions", "/approvals", "/finance", "/finance/profit", "/director-reports", "/finance/invoices", "/finance/payments", "/finance/receivables", "/finance/bills", "/finance/payables", "/finance/expenses", "/crm/clients", "/sales/quotations", "/projects", "/extra-work", "/closure", "/procurement/orders", "/procurement/vendors", "/documents", "/reports", ...STAFF_COMMON],
  HR: ["/dashboard", "/actions", "/hr/employees", "/hr/leaves", "/hr/payroll", "/hr/advances", "/hr/payslips", "/hr/announcements", "/workforce/attendance", "/workforce/workers", "/workforce/contractors", "/workforce/labour", "/closure", "/scorecards", "/documents"],
  MANAGEMENT: ["/dashboard", "/actions", "/exceptions", "/kpis", "/resources", "/time-limits", "/approvals", "/crm/leads", "/crm/clients", "/sales/quotations", "/sales/boq", "/sales/rates", "/projects", "/site-reports", "/transfers", "/extra-work", "/closure", "/scorecards", "/bills-to-certify", "/procurement/needs", "/procurement/orders", "/procurement/vendors", "/inventory/stock", "/workforce/attendance", "/hr/employees", "/hr/leaves", "/hr/payroll", "/hr/advances", "/hr/payslips", "/hr/announcements", "/finance", "/finance/profit", "/director-reports", "/finance/invoices", "/finance/payments", "/finance/receivables", "/finance/bills", "/finance/payables", "/finance/expenses", "/documents", "/reports", "/settings/company", "/settings/time-limits", "/settings/attendance", "/settings/audit"],
  ADMIN: ["/dashboard", "/actions", "/exceptions", "/kpis", "/resources", "/approvals", "/projects", "/closure", "/hr/employees", "/hr/leaves", "/hr/announcements", "/hr/payslips", "/documents", "/support", "/reports", "/settings/team", "/settings/company", "/settings/roles", "/settings/import", "/settings/terms", "/settings/time-limits", "/settings/attendance", "/settings/automation", "/settings/audit"],
  // OWNER: no list on purpose – the owner sees everything
};

export type MenuGroup = { label?: string; icon: string; href?: string; items: NavItem[] };

/** The sidebar for one user: permission-filtered, and trimmed to the role's simple menu if it has one. */
export function menuFor(role: RoleKey, can: (p: PermissionKey) => boolean): MenuGroup[] {
  const only = SIMPLE_MENU[role];
  const ok = (href: string, perm?: PermissionKey) => (!perm || can(perm)) && (!only || only.includes(href));
  return NAV.map((g) => ({ label: g.label, icon: g.icon, href: g.href, items: g.items.filter((i) => ok(i.href, i.perm) && !featureOff(i.href)), top: g.href ? ok(g.href, g.perm) && !featureOff(g.href) : false }))
    .filter((g) => (g.href ? g.top : g.items.length > 0))
    .map(({ top: _t, ...g }) => g);
}
