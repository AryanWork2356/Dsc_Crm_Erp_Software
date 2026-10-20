import type { RoleKey } from "@prisma/client";
import type { PermissionKey } from "./permissions";
import { USE_CONTRACTORS, USE_LEADS } from "./features";

export type NavItem = { label: string; href: string; perm?: PermissionKey };
export type NavGroup = { label?: string; icon: string; items: NavItem[]; href?: string; perm?: PermissionKey };

/**
 * Sidebar structure. Items are only listed once their page exists (no dead navigation).
 * Visibility is filtered by the user's permissions at render time.
 */
export const NAV: NavGroup[] = [
  { label: "Dashboard", icon: "layout-dashboard", href: "/dashboard", items: [], perm: "dashboard:view" },
  { label: "Time Limits", icon: "timer", href: "/time-limits", items: [], perm: "dashboard:view" },
  {
    label: "CRM",
    icon: "users",
    items: [
      { label: "Leads", href: "/crm/leads", perm: "leads:view" },
      { label: "Clients", href: "/crm/clients", perm: "clients:view" },
      { label: "Site Visits", href: "/crm/site-visits", perm: "sitevisits:view" },
      { label: "Follow-ups", href: "/crm/follow-ups", perm: "leads:view" },
    ],
  },
  {
    label: "Sales",
    icon: "file-text",
    items: [
      { label: "Quotations", href: "/sales/quotations", perm: "quotations:view" },
      { label: "Bill of Quantities", href: "/sales/boq", perm: "boq:view" },
      { label: "Client rates", href: "/sales/rates", perm: "margins:view" },
    ],
  },
  {
    label: "Projects",
    icon: "folder-kanban",
    items: [
      { label: "All Projects", href: "/projects", perm: "projects:view" },
      { label: "Daily Site Reports", href: "/site-reports", perm: "site_reports:view" },
      { label: "Transfers", href: "/transfers", perm: "transfers:view" },
      { label: "Extra Work", href: "/extra-work", perm: "extra_work:view" },
      { label: "Project Closure", href: "/closure", perm: "closure:view" },
      { label: "Scorecards", href: "/scorecards", perm: "scorecards:view" },
      { label: "Bills to Certify", href: "/bills-to-certify", perm: "bill_certification:view" },
      { label: "Tasks", href: "/projects/tasks", perm: "tasks:view" },
    ],
  },
  {
    label: "Procurement",
    icon: "shopping-cart",
    items: [
      { label: "Purchase Requests", href: "/procurement/requests", perm: "purchase_requests:view" },
      { label: "Purchase Orders", href: "/procurement/orders", perm: "purchase_orders:view" },
      { label: "Vendors", href: "/procurement/vendors", perm: "vendors:view" },
      { label: "Deliveries", href: "/procurement/deliveries", perm: "purchase_orders:view" },
    ],
  },
  {
    label: "Inventory",
    icon: "boxes",
    items: [
      { label: "Stock", href: "/inventory/stock", perm: "inventory:view" },
      { label: "Materials", href: "/inventory/materials", perm: "materials:view" },
      { label: "Material Receipts", href: "/inventory/receipts", perm: "inventory:view" },
      { label: "Issues & Returns", href: "/inventory/issues", perm: "inventory:view" },
      { label: "Stock Ledger", href: "/inventory/movements", perm: "inventory:view" },
      { label: "Locations", href: "/inventory/locations", perm: "inventory:view" },
    ],
  },
  {
    label: "Workforce",
    icon: "hard-hat",
    items: [
      { label: "Attendance", href: "/workforce/attendance", perm: "attendance:view" },
      { label: "Workers", href: "/workforce/workers", perm: "workers:view" },
      { label: "Contractors", href: "/workforce/contractors", perm: "contractors:view" },
      { label: "Labour Cost", href: "/workforce/labour", perm: "salary:view" },
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
    label: "Finance",
    icon: "wallet",
    items: [
      { label: "Overview", href: "/finance", perm: "finance:view" },
      { label: "Director Reports", href: "/director-reports", perm: "finance:view" },
      { label: "Invoices", href: "/finance/invoices", perm: "invoices:view" },
      { label: "Payments Received", href: "/finance/payments", perm: "payments:view" },
      { label: "Receivables", href: "/finance/receivables", perm: "invoices:view" },
      { label: "Vendor Bills", href: "/finance/bills", perm: "vendor_bills:view" },
      { label: "Payables", href: "/finance/payables", perm: "vendor_bills:view" },
      { label: "Expenses", href: "/finance/expenses", perm: "expenses:view" },
    ],
  },
  { label: "Documents", icon: "folder-open", href: "/documents", items: [], perm: "documents:view" },
  { label: "WhatsApp", icon: "message-circle", href: "/whatsapp", items: [], perm: "whatsapp:view" },
  { label: "Customer Support", icon: "life-buoy", href: "/support", items: [], perm: "support:view" },
  { label: "Marketing", icon: "bar-chart", href: "/marketing", items: [], perm: "marketing:view" },
  { label: "Reports", icon: "bar-chart", href: "/reports", items: [], perm: "reports:view" },
  { label: "Approvals", icon: "check-square", href: "/approvals", items: [], perm: "approvals:view" },
  { label: "Notifications", icon: "bell", href: "/notifications", items: [], perm: "notifications:view" },
  {
    label: "Admin",
    icon: "settings",
    items: [
      { label: "Team & Users", href: "/settings/team", perm: "team:view" },
      { label: "Company Settings", href: "/settings/company", perm: "settings:view" },
      { label: "Roles & Permissions", href: "/settings/roles", perm: "settings:view" },
      { label: "Import Data", href: "/settings/import", perm: "settings:view" },
      { label: "Terms Templates", href: "/settings/terms", perm: "settings:view" },
      { label: "WhatsApp Connection", href: "/settings/whatsapp", perm: "settings:manage" },
      { label: "Time Limits", href: "/settings/time-limits", perm: "settings:manage" },
      { label: "Attendance Location", href: "/settings/attendance", perm: "settings:manage" },
      { label: "Automation", href: "/settings/automation", perm: "settings:manage" },
      { label: "Audit Log", href: "/settings/audit", perm: "audit:view" },
    ],
  },
];

/**
 * Lean menus. Roles are allowed to open more screens than they need day to day, but their MENU shows only the jobs
 * they actually do (a supervisor sees 13 items instead of 25). This hides menu entries only –
 * what a role may open is still decided by the permission matrix and row scope. Add a role here to simplify its menu;
 * leave it out to show everything its permissions allow.
 */
const STAFF_COMMON = ["/hr/leaves", "/hr/payslips", "/hr/announcements", "/notifications"];
const SITE_CORE = ["/site-reports", "/projects", "/projects/tasks", "/procurement/requests", "/inventory/receipts", "/workforce/attendance", "/transfers", "/extra-work", "/finance/expenses", ...STAFF_COMMON];
export const SIMPLE_MENU: Partial<Record<RoleKey, string[]>> = {
  SITE_SUPERVISOR: SITE_CORE,
  SITE_ENGINEER: [...SITE_CORE, "/crm/site-visits", "/sales/boq", "/inventory/stock", "/inventory/issues", "/support"],
  PROJECT_MANAGER: ["/dashboard", "/time-limits", "/approvals", "/projects", "/site-reports", "/transfers", "/extra-work", "/bills-to-certify", "/closure", "/scorecards", "/projects/tasks", "/sales/boq", "/sales/rates", "/procurement/requests", "/procurement/orders", "/procurement/deliveries", "/inventory/stock", "/workforce/attendance", "/finance/expenses", "/documents", "/support", "/reports", ...STAFF_COMMON],
  SALES: ["/dashboard", "/time-limits", "/crm/leads", "/crm/follow-ups", "/crm/site-visits", "/crm/clients", "/sales/quotations", "/sales/boq", "/projects", "/whatsapp", "/reports", "/approvals", ...STAFF_COMMON],
  DESIGNER: ["/dashboard", "/crm/clients", "/crm/site-visits", "/sales/boq", "/sales/quotations", "/projects", "/projects/tasks", "/documents", "/approvals", ...STAFF_COMMON],
  PROCUREMENT: ["/dashboard", "/time-limits", "/approvals", "/procurement/requests", "/procurement/orders", "/procurement/vendors", "/procurement/deliveries", "/inventory/stock", "/inventory/materials", "/inventory/receipts", "/finance/bills", "/finance/payables", "/sales/boq", "/projects", "/site-reports", "/transfers", "/whatsapp", "/documents", "/reports", ...STAFF_COMMON],
  STORE: ["/dashboard", "/inventory/stock", "/inventory/materials", "/inventory/receipts", "/inventory/issues", "/inventory/movements", "/inventory/locations", "/procurement/orders", "/procurement/deliveries", "/transfers", "/site-reports", "/projects", ...STAFF_COMMON],
  ACCOUNTS: ["/dashboard", "/time-limits", "/approvals", "/finance", "/director-reports", "/finance/invoices", "/finance/payments", "/finance/receivables", "/finance/bills", "/finance/payables", "/finance/expenses", "/crm/clients", "/sales/quotations", "/projects", "/extra-work", "/closure", "/procurement/orders", "/procurement/vendors", "/documents", "/reports", ...STAFF_COMMON],
  HR: ["/dashboard", "/time-limits", "/hr/employees", "/hr/leaves", "/hr/payroll", "/hr/advances", "/hr/payslips", "/hr/announcements", "/workforce/attendance", "/workforce/workers", "/workforce/contractors", "/workforce/labour", "/closure", "/scorecards", "/documents", "/notifications"],
  MANAGEMENT: ["/dashboard", "/time-limits", "/approvals", "/crm/leads", "/crm/clients", "/sales/quotations", "/sales/boq", "/sales/rates", "/projects", "/site-reports", "/transfers", "/extra-work", "/closure", "/scorecards", "/bills-to-certify", "/procurement/orders", "/procurement/vendors", "/inventory/stock", "/workforce/attendance", "/hr/employees", "/hr/leaves", "/hr/payroll", "/hr/advances", "/hr/payslips", "/hr/announcements", "/finance", "/director-reports", "/finance/invoices", "/finance/payments", "/finance/receivables", "/finance/bills", "/finance/payables", "/finance/expenses", "/documents", "/reports", "/notifications", "/settings/company", "/settings/time-limits", "/settings/attendance", "/settings/audit"],
  ADMIN: ["/dashboard", "/approvals", "/projects", "/closure", "/hr/employees", "/hr/leaves", "/hr/announcements", "/hr/payslips", "/documents", "/support", "/reports", "/notifications", "/settings/team", "/settings/company", "/settings/roles", "/settings/import", "/settings/terms", "/settings/time-limits", "/settings/attendance", "/settings/automation", "/settings/audit"],
  // OWNER: no list on purpose – the owner sees everything
};

export type MenuGroup = { label?: string; icon: string; href?: string; items: NavItem[] };

/** The sidebar for one user: permission-filtered, and trimmed to the role's simple menu if it has one. */
export function menuFor(role: RoleKey, can: (p: PermissionKey) => boolean): MenuGroup[] {
  const only = SIMPLE_MENU[role];
  const ok = (href: string, perm?: PermissionKey) => (!perm || can(perm)) && (!only || only.includes(href));
  return NAV.map((g) => ({ label: g.label, icon: g.icon, href: g.href, items: g.items.filter((i) => ok(i.href, i.perm) && (USE_CONTRACTORS || !i.href.startsWith("/workforce/contractors")) && (USE_LEADS || !["/crm/leads", "/crm/follow-ups"].includes(i.href))), top: g.href ? ok(g.href, g.perm) : false }))
    .filter((g) => (g.href ? g.top : g.items.length > 0))
    .map(({ top: _t, ...g }) => g);
}
