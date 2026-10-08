import type { PermissionKey } from "./permissions";

export type NavItem = { label: string; href: string; perm?: PermissionKey };
export type NavGroup = { label?: string; icon: string; items: NavItem[]; href?: string; perm?: PermissionKey };

/**
 * Sidebar structure. Items are only listed once their page exists (no dead navigation).
 * Visibility is filtered by the user's permissions at render time.
 */
export const NAV: NavGroup[] = [
  { label: "Dashboard", icon: "layout-dashboard", href: "/dashboard", items: [], perm: "dashboard:view" },
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
    ],
  },
  {
    label: "Projects",
    icon: "folder-kanban",
    items: [
      { label: "All Projects", href: "/projects", perm: "projects:view" },
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
      { label: "My Payslips", href: "/hr/payslips", perm: "leaves:view" },
      { label: "Announcements", href: "/hr/announcements", perm: "notifications:view" },
    ],
  },
  {
    label: "Finance",
    icon: "wallet",
    items: [
      { label: "Overview", href: "/finance", perm: "finance:view" },
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
      { label: "Automation", href: "/settings/automation", perm: "settings:manage" },
      { label: "Audit Log", href: "/settings/audit", perm: "audit:view" },
    ],
  },
];
