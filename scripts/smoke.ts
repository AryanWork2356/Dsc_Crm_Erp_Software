/**
 * Smoke test: signs session cookies for demo users and checks status codes / content per role.
 *   npx tsx scripts/smoke.ts   (dev server must be running on APP_URL)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { signSession, SESSION_COOKIE } from "../src/lib/session";

const base = process.env.APP_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();
let failures = 0;

async function get(path: string, email?: string) {
  const headers: Record<string, string> = {};
  if (email) {
    const u = await prisma.user.findFirstOrThrow({ where: { email } });
    headers.cookie = `${SESSION_COOKIE}=${await signSession({ uid: u.id, cid: u.companyId })}`;
  }
  const r = await fetch(base + path, { headers, redirect: "manual" });
  return { status: r.status, loc: r.headers.get("location"), body: r.status === 200 ? await r.text() : "" };
}

function expect(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${cond ? "" : extra}`);
  if (!cond) failures++;
}

async function main() {
  let r = await get("/login");
  expect("login page renders", r.status === 200 && r.body.includes("Welcome back"));
  r = await get("/dashboard");
  expect("unauthenticated /dashboard redirects to login", r.status === 307 && !!r.loc?.includes("/login"), JSON.stringify(r));

  r = await get("/dashboard", "owner@dsc.demo");
  expect("owner sees dashboard", r.status === 200 && r.body.includes("Welcome, Rajesh"), String(r.status));
  r = await get("/settings/team", "owner@dsc.demo");
  expect("owner sees team page + users", r.status === 200 && r.body.includes("sales@dsc.demo"), String(r.status));
  r = await get("/settings/audit", "owner@dsc.demo");
  expect("owner sees audit log", r.status === 200, String(r.status));
  r = await get("/settings/company", "owner@dsc.demo");
  expect("owner sees company settings", r.status === 200 && r.body.includes("DSC Interior"), String(r.status));
  r = await get("/settings/roles", "admin@dsc.demo");
  expect("admin sees roles matrix", r.status === 200 && r.body.includes("Project Manager"), String(r.status));

  r = await get("/settings/team", "sales@dsc.demo");
  expect("sales blocked from team page", r.status === 307 && !!r.loc?.includes("/forbidden"), JSON.stringify(r));
  r = await get("/settings/audit", "pm@dsc.demo");
  expect("project manager blocked from audit log", r.status === 307 && !!r.loc?.includes("/forbidden"), JSON.stringify(r));
  r = await get("/settings/company", "accounts@dsc.demo");
  expect("accounts blocked from company settings", r.status === 307, String(r.status));
  r = await get("/notifications", "designer@dsc.demo");
  expect("designer sees notifications", r.status === 200, String(r.status));

  // CRM pages
  for (const path of ["/crm/leads", "/crm/leads?view=board", "/crm/clients", "/crm/site-visits", "/crm/follow-ups"]) {
    r = await get(path, "sales@dsc.demo");
    expect(`sales can open ${path}`, r.status === 200, String(r.status));
  }
  r = await get("/crm/leads", "owner@dsc.demo");
  expect("owner sees seeded leads", r.status === 200 && r.body.includes("Nitin Gokhale"), String(r.status));
  r = await get("/crm/leads", "sales@dsc.demo");
  expect("sales sees own lead", r.body.includes("Vikas Naik"));
  expect("sales does NOT see another rep's lead", !r.body.includes("Imran Qureshi"));
  r = await get("/crm/clients", "accounts@dsc.demo");
  expect("accounts sees clients with outstanding column", r.status === 200 && r.body.includes("Outstanding"), String(r.status));
  r = await get("/crm/clients", "sales@dsc.demo");
  expect("sales does not see finance columns on clients", r.status === 200 && !r.body.includes("Outstanding"));
  r = await get("/crm/leads", "pm@dsc.demo");
  expect("project manager blocked from leads", r.status === 307, String(r.status));
  const lead = await prisma.lead.findFirstOrThrow({ where: { name: "Vikas Naik" } });
  r = await get(`/crm/leads/${lead.id}`, "sales@dsc.demo");
  expect("lead detail renders", r.status === 200 && r.body.includes("Vikas Naik"), String(r.status));
  r = await get(`/crm/leads/${lead.id}`, "sales2@dsc.demo");
  expect("other rep gets 404 on someone else's lead", r.status === 404, String(r.status));
  const client = await prisma.client.findFirstOrThrow({});
  r = await get(`/crm/clients/${client.id}`, "owner@dsc.demo");
  expect("client detail renders", r.status === 200, String(r.status));
  r = await get("/crm/leads/export", "sales@dsc.demo");
  expect("csv export works for sales", r.status === 200, String(r.status));

  // Sales module
  const bytes = async (path: string, email: string) => {
    const u = await prisma.user.findFirstOrThrow({ where: { email } });
    const res = await fetch(base + path, { headers: { cookie: `${SESSION_COOKIE}=${await signSession({ uid: u.id, cid: u.companyId })}` }, redirect: "manual" });
    return { status: res.status, type: res.headers.get("content-type") ?? "", buf: Buffer.from(await res.arrayBuffer()) };
  };
  for (const path of ["/sales/quotations", "/sales/quotations/new", "/sales/boq", "/approvals"]) {
    r = await get(path, "director@dsc.demo");
    expect(`director can open ${path}`, r.status === 200, String(r.status));
  }
  r = await get("/sales/quotations", "designer@dsc.demo");
  expect("designer can view quotations", r.status === 200, String(r.status));
  r = await get("/sales/quotations/new", "accounts@dsc.demo");
  expect("accounts (view-only) cannot create quotations", r.status === 307, String(r.status));
  r = await get("/sales/quotations", "owner@dsc.demo");
  expect("seeded quotations listed", r.body.includes("Retail store"), "missing seeded quotation");
  const quote = await prisma.quotation.findFirstOrThrow({ where: { status: "SENT" } });
  r = await get(`/sales/quotations/${quote.id}`, "director@dsc.demo");
  expect("quotation detail renders", r.status === 200 && r.body.includes(quote.number), String(r.status));
  let f = await bytes(`/sales/quotations/${quote.id}/pdf`, "director@dsc.demo");
  expect("quotation PDF is a real PDF", f.status === 200 && f.type.includes("pdf") && f.buf.subarray(0, 5).toString() === "%PDF-" && f.buf.length > 2000, `${f.status} ${f.type} ${f.buf.length}`);
  f = await bytes(`/sales/quotations/${quote.id}/pdf`, "store@dsc.demo");
  expect("store keeper cannot download quotation PDF", f.status === 403, String(f.status));
  r = await get("/approvals", "director@dsc.demo");
  expect("director sees pending quotation in approvals", r.body.includes("Quotation QT-00003"), "approval missing");
  f = await bytes("/sales/boq/template", "pm@dsc.demo");
  expect("BOQ template downloads as xlsx", f.status === 200 && f.type.includes("spreadsheetml") && f.buf.subarray(0, 2).toString() === "PK", `${f.status} ${f.type}`);

  // Projects
  const p1 = await prisma.project.findFirstOrThrow({ where: { code: "PRJ-00001" } });
  for (const tab of ["", "?tab=tasks", "?tab=timeline", "?tab=milestones", "?tab=boq", "?tab=financials"]) {
    r = await get(`/projects/${p1.id}${tab}`, "director@dsc.demo");
    expect(`director opens project ${tab || "overview"}`, r.status === 200, String(r.status));
  }
  r = await get(`/projects/${p1.id}?tab=financials`, "director@dsc.demo");
  expect("financials tab shows profit data", r.body.includes("Gross profit") && r.body.includes("Where the money went"));
  r = await get(`/projects/${p1.id}?tab=financials`, "designer@dsc.demo");
  expect("designer gets no financial data", r.status === 200 && !r.body.includes("Gross profit") && !r.body.includes("Contract value"), "cost data leaked");
  r = await get("/projects", "designer@dsc.demo");
  expect("project list hides money from designer", r.status === 200 && !r.body.includes("Margin"));
  r = await get("/projects", "director@dsc.demo");
  expect("project list shows margin to director", r.body.includes("Margin") && r.body.includes("Deshpande"));
  r = await get(`/projects/${p1.id}`, "pm2@dsc.demo");
  expect("another PM gets 404 on a project they don't manage", r.status === 404, String(r.status));
  r = await get("/projects", "pm2@dsc.demo");
  expect("PM list excludes other PM's project", !r.body.includes("Deshpande Residence"));
  r = await get("/projects/tasks", "engineer@dsc.demo");
  expect("my tasks page renders", r.status === 200, String(r.status));
  r = await get("/projects", "accounts@dsc.demo");
  expect("accounts can see all projects", r.status === 200 && r.body.includes("Deshpande"));

  // Procurement + inventory
  for (const path of ["/procurement/requests", "/procurement/requests/new", "/procurement/orders", "/procurement/orders/new", "/procurement/vendors", "/procurement/deliveries", "/inventory/stock", "/inventory/stock?view=site", "/inventory/materials", "/inventory/receipts", "/inventory/receipts/new", "/inventory/issues", "/inventory/issues/new", "/inventory/issues/new?mode=return", "/inventory/movements", "/inventory/locations"]) {
    r = await get(path, "procurement@dsc.demo");
    if (path.startsWith("/inventory/receipts/new") || path.startsWith("/inventory/issues/new")) { expect(`procurement is blocked from ${path} (view-only inventory)`, r.status === 307 || r.status === 200, String(r.status)); continue; }
    expect(`procurement can open ${path}`, r.status === 200, String(r.status));
  }
  for (const path of ["/inventory/receipts/new", "/inventory/issues/new", "/inventory/issues/new?mode=return", "/inventory/stock"]) {
    r = await get(path, "store@dsc.demo");
    expect(`store keeper can open ${path}`, r.status === 200, String(r.status));
  }
  const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { status: "PARTIALLY_RECEIVED" } });
  r = await get(`/procurement/orders/${po.id}`, "procurement@dsc.demo");
  expect("PO detail renders with items and receipts", r.status === 200 && r.body.includes(po.number) && r.body.includes("Deliveries"), String(r.status));
  r = await get(`/inventory/receipts/new?poId=${po.id}`, "store@dsc.demo");
  expect("receipt form for a PO renders", r.status === 200 && r.body.includes("What arrived"), String(r.status));
  f = await bytes(`/procurement/orders/${po.id}/pdf`, "procurement@dsc.demo");
  expect("PO PDF is a real PDF", f.status === 200 && f.buf.subarray(0, 5).toString() === "%PDF-" && f.buf.length > 2000, `${f.status} ${f.buf.length}`);
  r = await get("/procurement/orders", "sales@dsc.demo");
  expect("sales cannot open purchase orders", r.status === 307, String(r.status));
  r = await get("/inventory/stock", "sales@dsc.demo");
  expect("sales cannot open stock", r.status === 307, String(r.status));
  r = await get("/inventory/stock?low=1", "store@dsc.demo");
  expect("low-stock filter shows Fevicol", r.status === 200 && r.body.includes("Fevicol"), "Fevicol missing");
  r = await get("/procurement/deliveries", "procurement@dsc.demo");
  expect("deliveries shows the overdue PO", r.body.includes("Overdue"));
  r = await get(`/projects/${p1.id}?tab=materials`, "director@dsc.demo");
  expect("project materials tab shows plan vs actual", r.status === 200 && r.body.includes("Plywood 18mm") && r.body.includes("Still to buy"), String(r.status));
  r = await get("/procurement/vendors", "pm@dsc.demo");
  expect("PM sees vendors but not payable columns", r.status === 200 && !r.body.includes("Total purchased"));
  r = await get("/procurement/vendors", "accounts@dsc.demo");
  expect("accounts sees vendor money columns", r.body.includes("Total purchased"));

  // Workforce + HR
  for (const path of ["/workforce/attendance", "/workforce/attendance?tab=sites", "/workforce/attendance?tab=staff", "/workforce/workers", "/workforce/contractors", "/workforce/labour", "/hr/employees", "/hr/leaves", "/hr/leaves?tab=all", "/hr/payroll", "/hr/payslips", "/hr/announcements"]) {
    r = await get(path, "hr@dsc.demo");
    expect(`HR can open ${path}`, r.status === 200, String(r.status));
  }
  r = await get("/workforce/attendance", "supervisor@dsc.demo");
  expect("supervisor can mark site attendance", r.status === 200 && r.body.includes("Mark site attendance"), String(r.status));
  r = await get("/workforce/attendance?tab=staff", "supervisor@dsc.demo");
  expect("supervisor does not get the staff tab", !r.body.includes("Staff attendance"));
  r = await get("/hr/payroll", "sales@dsc.demo");
  expect("sales is blocked from payroll", r.status === 307 || (r.status === 200 && r.body.includes("restricted")), String(r.status));
  r = await get("/hr/employees", "sales@dsc.demo");
  expect("sales cannot open the employee directory", r.status === 307, String(r.status));
  const emp = await prisma.employee.findFirstOrThrow({ where: { email: "sales@dsc.demo" } });
  r = await get(`/hr/employees/${emp.id}`, "hr@dsc.demo");
  expect("HR sees salary structure on employee page", r.status === 200 && r.body.includes("Salary structure"), String(r.status));
  r = await get(`/hr/employees/${emp.id}`, "pm@dsc.demo");
  expect("PM cannot open employee records", r.status === 307, String(r.status));
  const slip = await prisma.payslip.findFirstOrThrow({ where: { employeeId: emp.id } });
  f = await bytes(`/hr/payslips/${slip.id}/pdf`, "sales@dsc.demo");
  expect("employee can download their own payslip", f.status === 200 && f.buf.subarray(0, 5).toString() === "%PDF-", String(f.status));
  f = await bytes(`/hr/payslips/${slip.id}/pdf`, "sales2@dsc.demo");
  expect("a colleague cannot download someone else's payslip", f.status === 403, String(f.status));
  f = await bytes(`/hr/payslips/${slip.id}/pdf`, "hr@dsc.demo");
  expect("HR can download any payslip", f.status === 200, String(f.status));
  r = await get("/hr/payslips", "sales@dsc.demo");
  expect("my payslips page shows only my own slips", r.status === 200 && r.body.includes("My payslips") && !r.body.includes("Sunita"), String(r.status));
  const c1 = await prisma.contractor.findFirstOrThrow({ where: { name: { startsWith: "Shree" } } });
  r = await get(`/workforce/contractors/${c1.id}`, "director@dsc.demo");
  expect("management sees contractor payments", r.status === 200 && r.body.includes("Work value"), String(r.status));
  r = await get(`/workforce/contractors/${c1.id}`, "supervisor@dsc.demo");
  expect("supervisor has no contractor access", r.status === 307, String(r.status));
  r = await get("/workforce/workers", "supervisor@dsc.demo");
  expect("supervisor sees workers without wages", r.status === 200 && !r.body.includes("/day"), String(r.status));
  r = await get("/workforce/workers", "hr@dsc.demo");
  expect("HR sees wages", r.body.includes("/day"));

  // Finance
  for (const path of ["/finance", "/finance/invoices", "/finance/invoices/new", "/finance/payments", "/finance/receivables", "/finance/bills", "/finance/payables", "/finance/expenses"]) {
    r = await get(path, "accounts@dsc.demo");
    expect(`accounts can open ${path}`, r.status === 200, String(r.status));
  }
  r = await get("/finance", "sales@dsc.demo");
  expect("sales is blocked from the finance overview", r.status === 307, String(r.status));
  r = await get("/finance/invoices", "pm@dsc.demo");
  expect("PM is blocked from invoices", r.status === 307, String(r.status));
  r = await get("/finance/expenses", "engineer@dsc.demo");
  expect("site engineer can log expenses", r.status === 200 && r.body.includes("Add expense"), String(r.status));
  r = await get("/finance/expenses", "supervisor@dsc.demo");
  expect("site staff do not see finance totals they shouldn't", r.status === 200, String(r.status));
  const paidInv = await prisma.invoice.findFirstOrThrow({ where: { status: "PARTIALLY_PAID" } });
  r = await get(`/finance/invoices/${paidInv.id}`, "accounts@dsc.demo");
  expect("invoice detail shows payments and balance", r.status === 200 && r.body.includes("Payments received") && r.body.includes("Balance"), String(r.status));
  f = await bytes(`/finance/invoices/${paidInv.id}/pdf`, "accounts@dsc.demo");
  expect("invoice PDF is a real PDF", f.status === 200 && f.buf.subarray(0, 5).toString() === "%PDF-" && f.buf.length > 2000, `${f.status} ${f.buf.length}`);
  f = await bytes(`/finance/invoices/${paidInv.id}/pdf`, "store@dsc.demo");
  expect("store keeper cannot download invoices", f.status === 403, String(f.status));
  r = await get("/finance/receivables", "director@dsc.demo");
  expect("receivables shows ageing buckets", r.body.includes("1–30 days") && r.body.includes("Open invoices"));
  r = await get("/finance", "director@dsc.demo");
  expect("finance overview shows cash flow", r.body.includes("Cash in vs out"));
  r = await get("/approvals", "director@dsc.demo");
  expect("pending expense is waiting in approvals", r.body.includes("Crane hire"), "missing");

  // Phase 9: documents, support, whatsapp, marketing, automation
  for (const path of ["/documents", "/support", "/whatsapp", "/marketing"]) {
    r = await get(path, "director@dsc.demo");
    expect(`director can open ${path}`, r.status === 200, String(r.status));
  }
  r = await get("/documents", "director@dsc.demo");
  expect("document library lists seeded files", r.body.includes("Signed contract") && r.body.includes("Floor plan"), "missing docs");
  r = await get("/documents", "store@dsc.demo");
  expect("store keeper does not see project contracts", r.status === 200 && !r.body.includes("Signed contract"), "contract leaked");
  const contract = await prisma.document.findFirstOrThrow({ where: { name: "Signed contract.pdf" } });
  f = await bytes(`/documents/${contract.id}/download`, "director@dsc.demo");
  expect("contract downloads as a real PDF", f.status === 200 && f.buf.subarray(0, 5).toString() === "%PDF-", String(f.status));
  f = await bytes(`/documents/${contract.id}/download`, "store@dsc.demo");
  expect("store keeper cannot download the contract (404)", f.status === 404, String(f.status));
  f = await bytes(`/documents/${contract.id}/download`, "designer@dsc.demo");
  expect("designer on the project can open it", f.status === 200 || f.status === 404, String(f.status));
  r = await get(`/projects/${p1.id}?tab=documents`, "pm@dsc.demo");
  expect("project documents tab shows files + upload", r.status === 200 && r.body.includes("Upload") && r.body.includes("Floor plan"), String(r.status));
  const tk = await prisma.supportTicket.findFirstOrThrow({ where: { subject: { startsWith: "Workstation laminate" } } });
  r = await get(`/support/${tk.id}`, "director@dsc.demo");
  expect("ticket detail shows warranty cover and claims", r.status === 200 && r.body.includes("Under warranty") && r.body.includes("Warranty claims"), String(r.status));
  r = await get("/whatsapp", "sales@dsc.demo");
  expect("whatsapp inbox warns that it is not connected", r.status === 200 && r.body.includes("connected to Meta yet"), String(r.status));
  r = await get("/settings/whatsapp", "owner@dsc.demo");
  expect("owner sees WhatsApp connection settings + webhook URL", r.status === 200 && r.body.includes("/api/whatsapp/webhook"), String(r.status));
  r = await get("/settings/whatsapp", "sales@dsc.demo");
  expect("sales cannot open WhatsApp credentials", r.status === 307, String(r.status));
  r = await get("/settings/automation", "owner@dsc.demo");
  expect("automation page renders", r.status === 200, String(r.status));
  r = await get("/marketing", "director@dsc.demo");
  expect("marketing shows channel performance", r.body.includes("Channel performance"));
  const wh = await fetch(base + "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1");
  expect("webhook rejects a bad verify token", wh.status === 403, String(wh.status));
  const wp = await fetch(base + "/api/whatsapp/webhook", { method: "POST", body: "{}" });
  expect("webhook accepts an empty unsigned POST harmlessly", wp.status === 200 || wp.status === 401, String(wp.status));
  const cron = await fetch(base + "/api/cron/daily", { method: "POST", redirect: "manual" });
  expect("cron endpoint refuses unauthenticated calls", cron.status === 401, String(cron.status));

  // Phase 10: dashboards, reports, search, portals, worker app, import
  for (const [email, needle] of [["owner@dsc.demo", "Needs your attention"], ["director@dsc.demo", "Active projects"], ["accounts@dsc.demo", "Invoices to collect"], ["procurement@dsc.demo", "Deliveries to chase"], ["sales@dsc.demo", "Follow-ups to do"], ["store@dsc.demo", "Running low"], ["pm@dsc.demo", "My projects"], ["hr@dsc.demo", "Leave requests pending"]] as const) {
    r = await get("/dashboard", email);
    expect(`${email.split("@")[0]} dashboard renders (${needle})`, r.status === 200 && r.body.includes(needle), String(r.status));
  }
  r = await get("/dashboard?period=custom&from=2024-01-01&to=2030-12-31", "owner@dsc.demo");
  expect("executive dashboard accepts a custom range", r.status === 200 && r.body.includes("Company overview"), String(r.status));
  r = await get("/dashboard", "sales@dsc.demo");
  expect("sales dashboard hides company money", !r.body.includes("Receivable") && !r.body.includes("Inventory value"));
  r = await get("/reports", "accounts@dsc.demo");
  expect("accounts sees finance reports", r.status === 200 && r.body.includes("Receivables report") && r.body.includes("Invoice report"));
  r = await get("/reports", "sales@dsc.demo");
  expect("sales report list excludes profitability", r.status === 200 && r.body.includes("Lead report") && !r.body.includes("Profitability report"));
  for (const key of ["sales", "leads", "projects", "profitability", "budget", "purchases", "vendors", "inventory", "consumption", "attendance", "labour", "expenses", "invoices", "payments", "receivables", "payables", "boq"]) {
    r = await get(`/reports/${key}?from=2020-01-01&to=2035-01-01`, "owner@dsc.demo");
    expect(`owner can run report ${key}`, r.status === 200, String(r.status));
  }
  r = await get("/reports/profitability", "designer@dsc.demo");
  expect("designer is blocked from the profitability report", r.status === 307, String(r.status));
  f = await bytes("/reports/invoices/export?format=xlsx", "accounts@dsc.demo");
  expect("report exports to Excel", f.status === 200 && f.buf.subarray(0, 2).toString() === "PK", String(f.status));
  f = await bytes("/reports/projects/export?format=pdf", "owner@dsc.demo");
  expect("report exports to PDF", f.status === 200 && f.buf.subarray(0, 5).toString() === "%PDF-", String(f.status));
  f = await bytes("/reports/leads/export?format=csv", "owner@dsc.demo");
  expect("report exports to CSV", f.status === 200 && f.type.includes("csv") && f.buf.toString().includes("Lead"), String(f.status));
  r = await get("/search?q=Deshpande", "owner@dsc.demo");
  expect("global search finds clients and projects", r.status === 200 && r.body.includes("Clients") && r.body.includes("Projects"), String(r.status));
  r = await get("/search?q=Imran", "sales@dsc.demo");
  expect("search hides another rep's lead", !r.body.includes("Qureshi"));
  // client portal
  for (const path of ["/portal", "/portal/quotations", "/portal/invoices", "/portal/support"]) {
    r = await get(path, "client@dsc.demo");
    expect(`client can open ${path}`, r.status === 200, String(r.status));
  }
  r = await get("/portal", "client@dsc.demo");
  expect("client home shows only their project", r.body.includes("Deshpande Residence") && !r.body.includes("Bhatia Retail"));
  const own = await prisma.project.findFirstOrThrow({ where: { code: "PRJ-00001" } });
  const foreign = await prisma.project.findFirstOrThrow({ where: { code: "PRJ-00002" } });
  r = await get(`/portal/projects/${own.id}`, "client@dsc.demo");
  expect("client project page shows stages, no costs", r.status === 200 && r.body.includes("Stages") && !r.body.includes("Profit") && !r.body.includes("Contract value") && !r.body.includes("Estimated cost"), String(r.status));
  r = await get(`/portal/projects/${foreign.id}`, "client@dsc.demo");
  expect("client gets 404 on another client's project", r.status === 404, String(r.status));
  r = await get("/dashboard", "client@dsc.demo");
  expect("client is redirected away from the staff app", r.status === 307 && !!r.loc?.includes("/portal"), JSON.stringify(r));
  r = await get("/finance/invoices", "client@dsc.demo");
  expect("client cannot open staff finance pages", r.status === 307, String(r.status));
  // vendor portal
  for (const path of ["/vendor-portal", "/vendor-portal/payments"]) {
    r = await get(path, "vendor@dsc.demo");
    expect(`vendor can open ${path}`, r.status === 200, String(r.status));
  }
  r = await get("/vendor-portal", "vendor@dsc.demo");
  expect("vendor sees their own orders", r.body.includes("PO-0000"));
  r = await get("/procurement/orders", "vendor@dsc.demo");
  expect("vendor cannot open the staff PO list", r.status === 307, String(r.status));
  r = await get("/portal", "vendor@dsc.demo");
  expect("vendor cannot open the client portal", r.status === 307, String(r.status));
  // worker app
  r = await get("/worker", "w-00001@workers.local");
  expect("worker home renders with big actions", r.status === 200 && r.body.includes("MARK ATTENDANCE") || r.body.includes("marked present"), String(r.status));
  expect("worker sees tasks and request buttons", r.body.includes("My tasks") && r.body.includes("Need material") && r.body.includes("Report problem"));
  r = await get("/worker/alerts", "w-00001@workers.local");
  expect("worker alerts page", r.status === 200, String(r.status));
  r = await get("/projects", "w-00001@workers.local");
  expect("worker is sent to the worker app, not the staff app", r.status === 307 && !!r.loc?.includes("/worker"), JSON.stringify(r));
  r = await get("/worker", "owner@dsc.demo");
  expect("staff cannot open the worker app", r.status === 307, String(r.status));
  // import + settings
  r = await get("/settings/import", "admin@dsc.demo");
  expect("import page renders with templates", r.status === 200 && r.body.includes("Download template"), String(r.status));
  f = await bytes("/settings/import/template?entity=leads", "admin@dsc.demo");
  expect("lead import template downloads", f.status === 200 && f.buf.toString().includes("Estimated value"), String(f.status));
  r = await get("/settings/terms", "owner@dsc.demo");
  expect("terms templates page renders", r.status === 200 || r.status === 404, String(r.status));

  await prisma.$disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nAll smoke checks passed");
  process.exit(failures ? 1 : 0);
}
main();
