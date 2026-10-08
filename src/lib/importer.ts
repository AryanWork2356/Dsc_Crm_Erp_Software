import "server-only";
import ExcelJS from "exceljs";
import { z } from "zod";
import { BoqCategory, SegmentType, WageType, WorkerTrade } from "@prisma/client";
import { db } from "./db";
import type { Ctx } from "./auth";
import type { PermissionKey } from "./permissions";
import { nextNumber } from "./sequence";
import { audit } from "./audit";
import { UserError } from "./action";
import { zEmail, zGstin, zPan, zPhone } from "./form";

/**
 * Bulk import from CSV or Excel. Always two steps: CHECK (nothing is written, every problem is listed with its row
 * number) then IMPORT (all-or-nothing in one transaction). Existing records (same GSTIN / phone / SKU / email) are skipped,
 * never overwritten, so a file can be safely re-uploaded.
 */

export const MAX_ROWS = 2000;
export const MAX_BYTES = 5 * 1024 * 1024;

type Raw = Record<string, string>;
type Entity = {
  key: string; label: string; perm: PermissionKey;
  columns: { header: string; example: string; required?: boolean; hint?: string }[];
  /** Validate one row. Returns cleaned data or throws a ZodError. */
  parse: (r: Raw) => Record<string, unknown>;
  /** Natural key used to detect rows that already exist. */
  dedupe: (d: Record<string, unknown>) => { where: object; label: string } | null;
  exists: (c: Ctx, where: object) => Promise<boolean>;
  create: (tx: Tx, c: Ctx, d: Record<string, unknown>) => Promise<void>;
};
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

const s = z.string().trim().optional().transform((v) => (v ? v : undefined));
const n = (msg: string) => z.string().trim().optional().transform((v, ctx) => {
  if (!v) return undefined;
  const x = Number(v.replace(/[,₹\s]/g, ""));
  if (!Number.isFinite(x) || x < 0) { ctx.addIssue({ code: "custom", message: msg }); return z.NEVER; }
  return x;
});
const date = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00Z") : /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.test(v) ? new Date(`${v.split(/[/-]/)[2]}-${v.split(/[/-]/)[1].padStart(2, "0")}-${v.split(/[/-]/)[0].padStart(2, "0")}T00:00:00Z`) : null;
  if (!iso || isNaN(iso.getTime())) { ctx.addIssue({ code: "custom", message: "Use a date like 2024-03-31 or 31/03/2024" }); return z.NEVER; }
  return iso;
});
const pick = <T extends string>(vals: readonly T[], label: string, dflt: T) => z.string().trim().optional().transform((v, ctx) => {
  if (!v) return dflt;
  const k = v.toUpperCase().replace(/[\s/-]+/g, "_") as T;
  if (!vals.includes(k)) { ctx.addIssue({ code: "custom", message: `${label} must be one of: ${vals.join(", ")}` }); return z.NEVER; }
  return k;
});
const name = z.string({ message: "Name is required" }).trim().min(1, "Name is required");
const phone = zPhone.or(z.literal("").transform(() => undefined));
const parse = <T extends z.ZodType>(schema: T, r: Raw) => schema.parse(r) as Record<string, unknown>;

export const ENTITIES: Entity[] = [
  {
    key: "clients", label: "Clients", perm: "clients:create",
    columns: [{ header: "Name", example: "Meera Kulkarni", required: true }, { header: "Company", example: "Kulkarni Designs" }, { header: "Phone", example: "98200 12345" }, { header: "Email", example: "meera@example.com" }, { header: "Address", example: "Thane West" }, { header: "GSTIN", example: "27AABCD1234E1Z5" }, { header: "PAN", example: "AABCD1234E" }],
    parse: (r) => parse(z.object({ Name: name, Company: s, Phone: phone, Email: zEmail.or(z.literal("").transform(() => undefined)), Address: s, GSTIN: zGstin.or(z.literal("").transform(() => undefined)), PAN: zPan.or(z.literal("").transform(() => undefined)) }), r),
    dedupe: (d) => (d.GSTIN ? { where: { gstin: d.GSTIN }, label: `GSTIN ${d.GSTIN}` } : d.Phone ? { where: { phone: d.Phone }, label: `phone ${d.Phone}` } : null),
    exists: async (c, where) => !!(await db.client.findFirst({ where: { companyId: c.companyId, deletedAt: null, ...where } })),
    create: async (tx, c, d) => { await tx.client.create({ data: { companyId: c.companyId, code: await nextNumber(tx, c.companyId, "CL"), name: d.Name as string, companyName: d.Company as string | undefined, phone: d.Phone as string | undefined, email: d.Email as string | undefined, address: d.Address as string | undefined, gstin: d.GSTIN as string | undefined, pan: d.PAN as string | undefined } }); },
  },
  {
    key: "leads", label: "Leads", perm: "leads:create",
    columns: [{ header: "Name", example: "Sunil Rane", required: true }, { header: "Company", example: "" }, { header: "Phone", example: "98765 43210" }, { header: "Email", example: "" }, { header: "Source", example: "Instagram" }, { header: "Segment", example: "RESIDENTIAL", hint: "RESIDENTIAL, COMMERCIAL, RETAIL, CORPORATE or HOTEL" }, { header: "Location", example: "Kolshet, Thane" }, { header: "Estimated value", example: "1500000" }, { header: "Requirement", example: "3BHK full interior" }],
    parse: (r) => parse(z.object({ Name: name, Company: s, Phone: phone, Email: zEmail.or(z.literal("").transform(() => undefined)), Source: s, Segment: pick(Object.values(SegmentType), "Segment", "RESIDENTIAL"), Location: s, "Estimated value": n("Estimated value must be a number"), Requirement: s }), r),
    dedupe: (d) => (d.Phone ? { where: { phone: d.Phone }, label: `phone ${d.Phone}` } : null),
    exists: async (c, where) => !!(await db.lead.findFirst({ where: { companyId: c.companyId, deletedAt: null, ...where } })),
    create: async (tx, c, d) => {
      const sales = await tx.user.findMany({ where: { companyId: c.companyId, role: "SALES", isActive: true, deletedAt: null }, select: { id: true } });
      const counts = await tx.lead.groupBy({ by: ["assignedToId"], where: { companyId: c.companyId, deletedAt: null, stage: { notIn: ["WON", "LOST"] } }, _count: true });
      const load = new Map(counts.map((x) => [x.assignedToId, x._count]));
      const owner = c.role === "SALES" ? c.userId : sales.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0]?.id ?? null;
      await tx.lead.create({ data: { companyId: c.companyId, code: await nextNumber(tx, c.companyId, "LD"), name: d.Name as string, companyName: d.Company as string | undefined, phone: d.Phone as string | undefined, whatsapp: d.Phone as string | undefined, email: d.Email as string | undefined, source: (d.Source as string | undefined) ?? "Import", segment: d.Segment as SegmentType, location: d.Location as string | undefined, estimatedValue: d["Estimated value"] as number | undefined, requirement: d.Requirement as string | undefined, assignedToId: owner } });
    },
  },
  {
    key: "vendors", label: "Vendors", perm: "vendors:create",
    columns: [{ header: "Name", example: "Sai Hardware", required: true }, { header: "Contact person", example: "Ramesh" }, { header: "Phone", example: "98220 11223" }, { header: "Email", example: "" }, { header: "GSTIN", example: "" }, { header: "PAN", example: "" }, { header: "Categories", example: "Hinges, handles" }, { header: "Address", example: "Lohar Chawl" }],
    parse: (r) => parse(z.object({ Name: name, "Contact person": s, Phone: phone, Email: zEmail.or(z.literal("").transform(() => undefined)), GSTIN: zGstin.or(z.literal("").transform(() => undefined)), PAN: zPan.or(z.literal("").transform(() => undefined)), Categories: s, Address: s }), r),
    dedupe: (d) => (d.GSTIN ? { where: { gstin: d.GSTIN }, label: `GSTIN ${d.GSTIN}` } : { where: { name: { equals: d.Name as string, mode: "insensitive" } }, label: `name ${d.Name}` }),
    exists: async (c, where) => !!(await db.vendor.findFirst({ where: { companyId: c.companyId, deletedAt: null, ...where } })),
    create: async (tx, c, d) => { await tx.vendor.create({ data: { companyId: c.companyId, code: await nextNumber(tx, c.companyId, "V"), name: d.Name as string, contactPerson: d["Contact person"] as string | undefined, phone: d.Phone as string | undefined, email: d.Email as string | undefined, gstin: d.GSTIN as string | undefined, pan: d.PAN as string | undefined, categories: d.Categories as string | undefined, address: d.Address as string | undefined } }); },
  },
  {
    key: "materials", label: "Materials", perm: "materials:create",
    columns: [{ header: "Name", example: "Plywood 19mm BWP", required: true }, { header: "SKU", example: "PLY-19", hint: "Leave empty to auto-generate" }, { header: "Category", example: "CARPENTRY", hint: "CIVIL, CARPENTRY, ELECTRICAL, PLUMBING, PAINTING, FALSE_CEILING, FLOORING, FURNITURE, GLASS, HARDWARE, LIGHTING, HVAC, FABRICATION, DECOR, FIXTURES, OTHER" }, { header: "Unit", example: "sheet" }, { header: "Cost", example: "2850" }, { header: "Min stock", example: "10" }, { header: "Reorder level", example: "20" }],
    parse: (r) => parse(z.object({ Name: name, SKU: s, Category: pick(Object.values(BoqCategory), "Category", "OTHER"), Unit: s, Cost: n("Cost must be a number"), "Min stock": n("Min stock must be a number"), "Reorder level": n("Reorder level must be a number") }), r),
    dedupe: (d) => (d.SKU ? { where: { sku: d.SKU }, label: `SKU ${d.SKU}` } : { where: { name: { equals: d.Name as string, mode: "insensitive" } }, label: `name ${d.Name}` }),
    exists: async (c, where) => !!(await db.material.findFirst({ where: { companyId: c.companyId, deletedAt: null, ...where } })),
    create: async (tx, c, d) => {
      const sku = (d.SKU as string | undefined) ?? (await nextNumber(tx, c.companyId, "MAT"));
      await tx.material.create({ data: { companyId: c.companyId, sku, name: d.Name as string, category: d.Category as BoqCategory, unit: (d.Unit as string | undefined) ?? "nos", purchaseCost: (d.Cost as number | undefined) ?? 0, minStock: (d["Min stock"] as number | undefined) ?? 0, reorderLevel: (d["Reorder level"] as number | undefined) ?? 0 } });
    },
  },
  {
    key: "workers", label: "Workers", perm: "workers:create",
    columns: [{ header: "Name", example: "Ravi Patil", required: true }, { header: "Phone", example: "98765 00001" }, { header: "Trade", example: "CARPENTER", hint: "CARPENTER, ELECTRICIAN, PLUMBER, PAINTER, CIVIL, FABRICATOR, HELPER, INSTALLER, FALSE_CEILING, OTHER" }, { header: "Wage type", example: "DAILY", hint: "DAILY, MONTHLY or CONTRACT" }, { header: "Daily wage", example: "900" }, { header: "Monthly wage", example: "" }, { header: "Joining date", example: "2024-04-01" }],
    parse: (r) => {
      const d = parse(z.object({ Name: name, Phone: phone, Trade: pick(Object.values(WorkerTrade), "Trade", "HELPER"), "Wage type": pick(Object.values(WageType), "Wage type", "DAILY"), "Daily wage": n("Daily wage must be a number"), "Monthly wage": n("Monthly wage must be a number"), "Joining date": date }), r);
      if (d["Wage type"] === "DAILY" && !(d["Daily wage"] as number) ) throw new z.ZodError([{ code: "custom", path: ["Daily wage"], message: "Daily wage is required for daily-wage workers", input: undefined }]);
      if (d["Wage type"] === "MONTHLY" && !(d["Monthly wage"] as number)) throw new z.ZodError([{ code: "custom", path: ["Monthly wage"], message: "Monthly wage is required for monthly workers", input: undefined }]);
      return d;
    },
    dedupe: (d) => (d.Phone ? { where: { phone: d.Phone }, label: `phone ${d.Phone}` } : null),
    exists: async (c, where) => !!(await db.worker.findFirst({ where: { companyId: c.companyId, deletedAt: null, ...where } })),
    create: async (tx, c, d) => { await tx.worker.create({ data: { companyId: c.companyId, code: await nextNumber(tx, c.companyId, "W"), name: d.Name as string, phone: d.Phone as string | undefined, trade: d.Trade as WorkerTrade, wageType: d["Wage type"] as WageType, dailyWage: (d["Daily wage"] as number | undefined) ?? 0, monthlyWage: (d["Monthly wage"] as number | undefined) ?? 0, joiningDate: d["Joining date"] as Date | undefined } }); },
  },
  {
    key: "employees", label: "Employees", perm: "employees:create",
    columns: [{ header: "Name", example: "Pooja Shinde", required: true }, { header: "Email", example: "pooja@dscinterior.com" }, { header: "Phone", example: "98200 22334" }, { header: "Designation", example: "Junior Designer" }, { header: "Department", example: "Design" }, { header: "Joining date", example: "2024-06-03" }],
    parse: (r) => parse(z.object({ Name: name, Email: zEmail.or(z.literal("").transform(() => undefined)), Phone: phone, Designation: s, Department: s, "Joining date": date }), r),
    dedupe: (d) => (d.Email ? { where: { email: { equals: d.Email as string, mode: "insensitive" } }, label: `email ${d.Email}` } : null),
    exists: async (c, where) => !!(await db.employee.findFirst({ where: { companyId: c.companyId, deletedAt: null, ...where } })),
    create: async (tx, c, d) => { await tx.employee.create({ data: { companyId: c.companyId, code: await nextNumber(tx, c.companyId, "EMP", 3), name: d.Name as string, email: d.Email as string | undefined, phone: d.Phone as string | undefined, designation: d.Designation as string | undefined, department: d.Department as string | undefined, joiningDate: d["Joining date"] as Date | undefined } }); },
  },
];

export const entityByKey = (k: string) => ENTITIES.find((e) => e.key === k);

// ───────── file reading ─────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const cell = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return "result" in v && v.result !== undefined ? String(v.result) : "text" in v ? String(v.text) : "richText" in v ? v.richText.map((x) => x.text).join("") : "";
  return String(v).trim();
};

export async function readTable(file: File): Promise<Raw[]> {
  if (!file || file.size === 0) throw new UserError("Choose a CSV or Excel file.");
  if (file.size > MAX_BYTES) throw new UserError("File is too large (max 5 MB).");
  const lower = file.name.toLowerCase();
  let grid: string[][];
  if (lower.endsWith(".csv")) grid = parseCsv(Buffer.from(await file.arrayBuffer()).toString("utf8"));
  else if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as never); } catch { throw new UserError("That file couldn't be read as an Excel workbook."); }
    const ws = wb.worksheets[0];
    if (!ws) throw new UserError("The workbook is empty.");
    grid = [];
    ws.eachRow({ includeEmpty: false }, (row) => { const vals: string[] = []; for (let c = 1; c <= row.cellCount; c++) vals.push(cell(row.getCell(c).value)); if (vals.some((v) => v)) grid.push(vals); });
  } else throw new UserError("Only .csv and .xlsx files are supported. Download the template for the right layout.");
  if (grid.length < 2) throw new UserError("The file has no data rows under the header.");
  if (grid.length - 1 > MAX_ROWS) throw new UserError(`Too many rows (max ${MAX_ROWS} per file). Split the file and import in parts.`);
  const headers = grid[0].map((h) => h.trim());
  return grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// ───────── check / import ─────────
export type ImportReport = { total: number; valid: number; duplicates: number; errors: { row: number; message: string }[]; created: number };

export async function runImport(c: Ctx, entity: Entity, rows: Raw[], commit: boolean): Promise<ImportReport> {
  const required = entity.columns.filter((x) => x.required).map((x) => x.header);
  const present = Object.keys(rows[0] ?? {});
  const missing = required.filter((h) => !present.some((p) => p.toLowerCase() === h.toLowerCase()));
  if (missing.length) throw new UserError(`The file is missing the column(s): ${missing.join(", ")}. Download the template for the exact layout.`);
  // normalise header case so "name" == "Name"
  const canon = new Map(entity.columns.map((x) => [x.header.toLowerCase(), x.header]));
  const norm = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [canon.get(k.toLowerCase()) ?? k, v])));

  const errors: ImportReport["errors"] = [];
  const good: Record<string, unknown>[] = [];
  let duplicates = 0;
  const seen = new Set<string>();
  for (let i = 0; i < norm.length; i++) {
    const rowNo = i + 2; // header is row 1
    try {
      const d = entity.parse(norm[i]);
      const dk = entity.dedupe(d);
      if (dk) {
        const key = JSON.stringify(dk.where);
        if (seen.has(key) || (await entity.exists(c, dk.where))) { duplicates++; continue; }
        seen.add(key);
      }
      good.push(d);
    } catch (e) {
      const issues = e instanceof z.ZodError ? e.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`).join("; ") : e instanceof Error ? e.message : "Invalid row";
      errors.push({ row: rowNo, message: issues });
      if (errors.length >= 50) break;
    }
  }
  const report: ImportReport = { total: norm.length, valid: good.length, duplicates, errors, created: 0 };
  if (!commit || errors.length) return report;
  await db.$transaction(async (tx) => {
    for (const d of good) await entity.create(tx, c, d);
    await audit(c, { action: "CREATE", entityType: "Import", summary: `${c.name} imported ${good.length} ${entity.label.toLowerCase()} from a file (${duplicates} duplicates skipped)` }, tx);
  }, { timeout: 120000 });
  report.created = good.length;
  return report;
}

export function templateCsv(entity: Entity) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [entity.columns.map((x) => x.header), entity.columns.map((x) => x.example)].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
