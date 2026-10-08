import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import type { Ctx } from "./auth";
import { clientScope, leadScope, projectScope, projectDocScope } from "./scope";

export type Hit = { id: string; title: string; sub?: string; href: string };
export type Group = { key: string; label: string; hits: Hit[] };

const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });
const LIMIT = 6;

/** Searches every module the user can see, using the same scoping as the list screens. */
export async function globalSearch(c: Ctx, raw: string): Promise<Group[]> {
  const q = raw.trim();
  if (q.length < 2) return [];
  const co = c.companyId;
  const jobs: Promise<Group | null>[] = [];
  const add = (perm: Parameters<typeof c.can>[0], key: string, label: string, fn: () => Promise<Hit[]>) => {
    if (c.can(perm)) jobs.push(fn().then((hits) => (hits.length ? { key, label, hits } : null)));
  };

  add("clients:view", "clients", "Clients", async () => (await db.client.findMany({ where: { ...clientScope(c), OR: [{ name: ci(q) }, { companyName: ci(q) }, { code: ci(q) }, { phone: { contains: q } }, { email: ci(q) }, { gstin: ci(q) }] }, take: LIMIT })).map((x) => ({ id: x.id, title: x.name, sub: `${x.code}${x.companyName ? ` · ${x.companyName}` : ""}`, href: `/crm/clients/${x.id}` })));
  add("leads:view", "leads", "Leads", async () => (await db.lead.findMany({ where: { ...leadScope(c), OR: [{ name: ci(q) }, { companyName: ci(q) }, { code: ci(q) }, { phone: { contains: q } }, { location: ci(q) }] }, take: LIMIT })).map((x) => ({ id: x.id, title: x.name, sub: `${x.code} · ${x.stage.toLowerCase().replace(/_/g, " ")}`, href: `/crm/leads/${x.id}` })));
  add("projects:view", "projects", "Projects", async () => (await db.project.findMany({ where: { ...projectScope(c), OR: [{ name: ci(q) }, { code: ci(q) }, { siteAddress: ci(q) }, { client: { name: ci(q) } }] }, include: { client: { select: { name: true } } }, take: LIMIT })).map((x) => ({ id: x.id, title: x.name, sub: `${x.code} · ${x.client.name}`, href: `/projects/${x.id}` })));
  add("quotations:view", "quotations", "Quotations", async () => (await db.quotation.findMany({ where: { companyId: co, deletedAt: null, ...(c.role === "SALES" ? { OR: [{ preparedById: c.userId }, { lead: { assignedToId: c.userId } }] } : {}), AND: [{ OR: [{ number: ci(q) }, { title: ci(q) }, { client: { name: ci(q) } }] }] }, include: { client: { select: { name: true } } }, take: LIMIT })).map((x) => ({ id: x.id, title: x.number, sub: `${x.client.name}${x.title ? ` · ${x.title}` : ""}`, href: `/sales/quotations/${x.id}` })));
  add("boq:view", "boq", "BOQs", async () => (await db.boq.findMany({ where: { companyId: co, deletedAt: null, OR: [{ number: ci(q) }, { title: ci(q) }, { items: { some: { item: ci(q) } } }] }, take: LIMIT })).map((x) => ({ id: x.id, title: x.number, sub: x.title, href: `/sales/boq/${x.id}` })));
  add("purchase_orders:view", "pos", "Purchase orders", async () => (await db.purchaseOrder.findMany({ where: { companyId: co, ...(["OWNER", "MANAGEMENT", "ADMIN", "PROCUREMENT", "ACCOUNTS", "STORE"].includes(c.role) ? {} : { project: projectScope(c) }), AND: [{ OR: [{ number: ci(q) }, { vendor: { name: ci(q) } }, { items: { some: { description: ci(q) } } }] }] }, include: { vendor: { select: { name: true } } }, take: LIMIT })).map((x) => ({ id: x.id, title: x.number, sub: x.vendor.name, href: `/procurement/orders/${x.id}` })));
  add("vendors:view", "vendors", "Vendors", async () => (await db.vendor.findMany({ where: { companyId: co, deletedAt: null, OR: [{ name: ci(q) }, { code: ci(q) }, { categories: ci(q) }, { phone: { contains: q } }, { gstin: ci(q) }] }, take: LIMIT })).map((x) => ({ id: x.id, title: x.name, sub: `${x.code}${x.categories ? ` · ${x.categories}` : ""}`, href: `/procurement/vendors/${x.id}` })));
  add("materials:view", "materials", "Materials", async () => (await db.material.findMany({ where: { companyId: co, deletedAt: null, OR: [{ name: ci(q) }, { sku: ci(q) }] }, take: LIMIT })).map((x) => ({ id: x.id, title: x.name, sub: x.sku, href: `/inventory/materials/${x.id}` })));
  add("invoices:view", "invoices", "Invoices", async () => (await db.invoice.findMany({ where: { companyId: co, deletedAt: null, OR: [{ number: ci(q) }, { client: { name: ci(q) } }] }, include: { client: { select: { name: true } } }, take: LIMIT })).map((x) => ({ id: x.id, title: x.number, sub: x.client.name, href: `/finance/invoices/${x.id}` })));
  add("employees:view", "employees", "Employees", async () => (await db.employee.findMany({ where: { companyId: co, deletedAt: null, OR: [{ name: ci(q) }, { code: ci(q) }, { designation: ci(q) }, { phone: { contains: q } }] }, take: LIMIT })).map((x) => ({ id: x.id, title: x.name, sub: `${x.code} · ${x.designation ?? ""}`, href: `/hr/employees/${x.id}` })));
  add("workers:view", "workers", "Workers", async () => (await db.worker.findMany({ where: { companyId: co, deletedAt: null, OR: [{ name: ci(q) }, { code: ci(q) }, { phone: { contains: q } }] }, take: LIMIT })).map((x) => ({ id: x.id, title: x.name, sub: `${x.code} · ${x.trade.toLowerCase()}`, href: `/workforce/workers?q=${encodeURIComponent(x.name)}` })));
  add("documents:view", "documents", "Documents", async () => {
    const wide = ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role);
    const projects = wide ? [] : (await db.project.findMany({ where: projectDocScope(c), select: { id: true } })).map((p) => p.id);
    const vis: Prisma.DocumentWhereInput = wide ? {} : { OR: [{ uploadedById: c.userId }, { entityType: "PROJECT", entityId: { in: projects } }, { entityType: "CLIENT", ...(c.can("clients:view") ? {} : { id: "none" }) }, { entityType: "VENDOR", ...(c.can("vendors:view") ? {} : { id: "none" }) }] };
    return (await db.document.findMany({ where: { companyId: co, deletedAt: null, AND: [vis, { OR: [{ name: ci(q) }, { tags: ci(q) }, { folder: ci(q) }] }] }, take: LIMIT })).map((x) => ({ id: x.id, title: x.name, sub: `${x.type.toLowerCase().replace(/_/g, " ")}${x.folder ? ` · ${x.folder}` : ""}`, href: `/documents?q=${encodeURIComponent(x.name)}` }));
  });
  add("support:view", "tickets", "Support tickets", async () => (await db.supportTicket.findMany({ where: { companyId: co, OR: [{ number: ci(q) }, { subject: ci(q) }, { client: { name: ci(q) } }] }, take: LIMIT })).map((x) => ({ id: x.id, title: x.subject, sub: x.number, href: `/support/${x.id}` })));

  return (await Promise.all(jobs)).filter((g): g is Group => g !== null);
}
