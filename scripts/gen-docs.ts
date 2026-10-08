/**
 * Generates docs/DATABASE.md (from prisma/schema.prisma) and docs/ROLES_AND_PERMISSIONS.md (from src/lib/permissions.ts)
 * so the documentation can never drift from the code.   npm run docs
 */
import fs from "node:fs";
import path from "node:path";
import { ACTIONS, MODULES, ROLE_LABELS, permissionMatrix, SPECIAL } from "../src/lib/permissions";

const root = path.resolve(__dirname, "..");
const docs = path.join(root, "docs");
fs.mkdirSync(docs, { recursive: true });

// ───────── DATABASE.md ─────────
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], body: m[2] }));
const enums = [...schema.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], values: m[2].split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")) }));
const modelNames = new Set(models.map((m) => m.name));

const GROUPS: [string, string[]][] = [
  ["Company, users & security", ["Company", "CompanySettings", "Sequence", "Permission", "RolePermission", "User", "AuditLog", "Notification", "Approval", "ApprovalStep", "TermsAndConditions", "Announcement"]],
  ["CRM", ["Client", "Lead", "LeadActivity", "SiteVisit", "MarketingCampaign", "WhatsAppConversation", "WhatsAppMessage"]],
  ["Sales", ["Quotation", "QuotationItem", "QuotationRevision", "Boq", "BoqItem"]],
  ["Projects", ["Project", "ProjectMember", "ProjectTask", "TaskComment", "ProjectMilestone", "SupportTicket", "WarrantyClaim"]],
  ["Procurement & inventory", ["Vendor", "Material", "Warehouse", "StockBalance", "InventoryTransaction", "PurchaseRequest", "PurchaseRequestItem", "PurchaseOrder", "PurchaseOrderItem", "MaterialReceipt", "MaterialReceiptItem", "MaterialIssue", "MaterialIssueItem"]],
  ["People & payroll", ["Employee", "SalaryStructure", "Payslip", "Leave", "Worker", "Contractor", "WorkOrder", "ContractorPayment", "Attendance"]],
  ["Finance", ["Invoice", "InvoiceItem", "Payment", "VendorBill", "VendorPayment", "Expense"]],
  ["Documents", ["Document"]],
];

let db = `# Database\n\n> Generated from \`prisma/schema.prisma\` by \`npm run docs\` – do not edit by hand.\n\nPostgreSQL, managed with Prisma migrations (\`prisma/migrations\`). **${models.length} tables, ${enums.length} enums.**\n\n`;
db += `## Design rules\n\n- **Multi-tenant:** every business table carries \`companyId\`; every query is filtered by it, so one company can never read another's data.\n- **Money** is stored as \`Decimal(14,2)\` – never floating point. Quantities use \`Decimal(12–14,3)\`.\n- **Soft delete** (\`deletedAt\`) on records that other records refer to (clients, leads, projects, vendors, quotations, invoices, BOQs, workers, employees…). History is never lost.\n- **Stock is a ledger:** \`StockBalance\` is only ever changed together with an \`InventoryTransaction\` row inside one database transaction.\n- **Numbering** (\`QT-00045\`, \`PO-00031\`, \`INV-…\`) comes from \`Sequence\`, incremented atomically inside the saving transaction.\n- **Audit:** \`AuditLog\` is append-only; there is no code path that edits or deletes it.\n- Foreign keys and indexes exist on every lookup column used by the screens (company + status, company + date, company + project…).\n\n`;
for (const [title, names] of GROUPS) {
  db += `## ${title}\n\n`;
  for (const n of names) {
    const m = models.find((x) => x.name === n);
    if (!m) continue;
    const fields = m.body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"));
    const rows = fields.map((l) => {
      const [name, type, ...rest] = l.split(/\s+/);
      const t = type?.replace("?", "").replace("[]", "");
      const rel = modelNames.has(t) ? ` → ${t}${type.endsWith("[]") ? " (many)" : ""}` : "";
      const flags = [type?.endsWith("?") ? "optional" : "", rest.join(" ").includes("@unique") ? "unique" : "", rest.join(" ").includes("@id") ? "primary key" : ""].filter(Boolean).join(", ");
      return `| \`${name}\` | ${type}${rel} | ${flags} |`;
    });
    const idx = [...m.body.matchAll(/^\s*@@(unique|index)\(\[([^\]]+)\]/gm)].map((x) => `${x[1]}: ${x[2]}`);
    db += `### ${n}\n\n| Field | Type | Notes |\n|---|---|---|\n${rows.join("\n")}\n\n${idx.length ? `Indexes: ${idx.map((i) => `\`${i}\``).join(", ")}\n\n` : ""}`;
  }
}
const grouped = new Set(GROUPS.flatMap(([, n]) => n));
const rest = models.filter((m) => !grouped.has(m.name));
if (rest.length) db += `## Other\n\n${rest.map((m) => `- ${m.name}`).join("\n")}\n\n`;
db += `## Enums\n\n${enums.map((e) => `- **${e.name}**: ${e.values.join(", ")}`).join("\n")}\n`;
fs.writeFileSync(path.join(docs, "DATABASE.md"), db);

// ───────── ROLES_AND_PERMISSIONS.md ─────────
const matrix = permissionMatrix();
let rp = `# Roles & permissions\n\n> Generated from \`src/lib/permissions.ts\` by \`npm run docs\` – do not edit by hand.\n\nAccess is decided in **two layers**:\n\n1. **Permission** (this page) – *what* a role may do in a module: view, create, edit, delete, approve, export, manage.\n2. **Data scope** – *which records* the role may see. Examples: a Sales user sees only leads assigned to them; a Project Manager sees only projects they work on; a Client sees only their own project, quotations and invoices; a Vendor sees only their own purchase orders; a Worker sees only their own tasks. Scoping is enforced inside every query (\`src/lib/scope.ts\`), not just in the menu.\n\nSensitive information has its own switches: **margins:view** (costs, margins, profit), **salary:view**, **finance:view**, **audit:view**, **users:manage**.\n\nMenus are hidden for modules a role cannot open, and the server re-checks on every page, download and action – hiding a menu is never the only protection.\n\n`;
rp += `## Summary\n\n| Role | Modules | Cost & margin | Salaries | Finance overview | Audit log | Manage users |\n|---|---|---|---|---|---|---|\n`;
for (const r of matrix) {
  const set = new Set(r.permissions);
  const mods = MODULES.filter((m) => ACTIONS.some((a) => set.has(`${m}:${a}`))).length;
  const yes = (k: string) => (set.has(k) ? "✔" : "–");
  rp += `| ${r.label} | ${mods} | ${yes("margins:view")} | ${yes("salary:view")} | ${yes("finance:view")} | ${yes("audit:view")} | ${yes("users:manage")} |\n`;
}
rp += `\n## Full matrix\n\nColumns: **V**iew · **C**reate · **E**dit · **D**elete · **A**pprove · e**X**port · **M**anage.\n\n`;
for (const r of matrix) {
  const set = new Set(r.permissions);
  rp += `### ${r.label}\n\n| Module | V | C | E | D | A | X | M |\n|---|---|---|---|---|---|---|---|\n`;
  for (const m of MODULES) {
    if (!ACTIONS.some((a) => set.has(`${m}:${a}`))) continue;
    rp += `| ${m.replace(/_/g, " ")} | ${ACTIONS.map((a) => (set.has(`${m}:${a}`) ? "✔" : "")).join(" | ")} |\n`;
  }
  const sp = (SPECIAL as readonly string[]).filter((s) => set.has(s));
  rp += `\nSpecial access: ${sp.length ? sp.join(", ") : "none"}\n\n`;
}
rp += `## Approval authority\n\nWho can approve what, by amount (limits are configurable in Settings → Company):\n\n| Type | ≤ Level 1 (default ₹25,000) | ≤ Level 2 (default ₹1,00,000) | Above |\n|---|---|---|---|\n| Purchase request, purchase order, expense, vendor payment | Project Manager* | Management | Owner |\n| Quotation, BOQ, invoice, discount, budget | Management | Management | Management |\n| Leave | HR | HR | HR |\n\n*A Project Manager can approve only for projects they manage. A person never approves their own request (except the Owner). Management and the Owner can approve anything the level below them can. If the requester already has enough authority the request is auto-approved – and still audited.\n\n## Role labels\n\n${Object.entries(ROLE_LABELS).map(([k, v]) => `- \`${k}\` – ${v}`).join("\n")}\n`;
fs.writeFileSync(path.join(docs, "ROLES_AND_PERMISSIONS.md"), rp);
console.log(`Wrote docs/DATABASE.md (${models.length} models) and docs/ROLES_AND_PERMISSIONS.md (${matrix.length} roles)`);
