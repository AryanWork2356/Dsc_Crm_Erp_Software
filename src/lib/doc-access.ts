import "server-only";
import type { Document } from "@prisma/client";
import { db } from "./db";
import type { Ctx } from "./auth";
import { projectDocScope, clientScope, leadScope } from "./scope";

/**
 * Who may open a document. A document inherits the visibility of the record it is attached to:
 *   PROJECT/QUOTATION/BOQ → project access, CLIENT/LEAD → CRM scope, EMPLOYEE → HR only,
 *   VENDOR/PO → procurement, INVOICE → finance. Portal users only get files explicitly shared with them.
 */

export const ENTITY_TYPES = ["CLIENT", "LEAD", "PROJECT", "EMPLOYEE", "VENDOR", "QUOTATION", "PO", "INVOICE", "BOQ", "SITE_VISIT", "TICKET", "GENERAL"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

const STAFF_ALL = ["OWNER", "MANAGEMENT", "ADMIN"];

export async function canViewEntity(c: Ctx, type: string | null, id: string | null): Promise<boolean> {
  if (!c.can("documents:view") && c.role !== "CLIENT" && c.role !== "VENDOR") return false;
  if (!type || type === "GENERAL" || !id) return STAFF_ALL.includes(c.role) || c.can("documents:manage");
  switch (type) {
    case "PROJECT":
      return !!(await db.project.findFirst({ where: { id, ...projectDocScope(c) }, select: { id: true } }));
    case "QUOTATION": {
      const q = await db.quotation.findFirst({ where: { id, companyId: c.companyId }, select: { projectId: true, preparedById: true, clientId: true } });
      if (!q) return false;
      if (c.role === "CLIENT") return q.clientId === c.clientId;
      return STAFF_ALL.includes(c.role) || q.preparedById === c.userId || (c.can("quotations:view") && c.role !== "SALES");
    }
    case "BOQ": {
      const b = await db.boq.findFirst({ where: { id, companyId: c.companyId }, select: { projectId: true } });
      if (!b) return false;
      return b.projectId ? !!(await db.project.findFirst({ where: { id: b.projectId, ...projectDocScope(c) }, select: { id: true } })) : STAFF_ALL.includes(c.role) || c.can("boq:view");
    }
    case "CLIENT":
      return !!(await db.client.findFirst({ where: { id, ...clientScope(c) }, select: { id: true } }));
    case "LEAD":
      return !!(await db.lead.findFirst({ where: { id, ...leadScope(c) }, select: { id: true } }));
    case "SITE_VISIT":
      return c.can("sitevisits:view");
    case "EMPLOYEE":
      return c.can("employees:view") || !!(await db.employee.findFirst({ where: { id, userId: c.userId }, select: { id: true } }));
    case "VENDOR":
      return c.role === "VENDOR" ? c.vendorId === id : c.can("vendors:view");
    case "PO": {
      if (c.role === "VENDOR") return !!(await db.purchaseOrder.findFirst({ where: { id, vendorId: c.vendorId ?? "none" }, select: { id: true } }));
      return c.can("purchase_orders:view");
    }
    case "INVOICE": {
      if (c.role === "CLIENT") return !!(await db.invoice.findFirst({ where: { id, clientId: c.clientId ?? "none", deletedAt: null }, select: { id: true } }));
      return c.can("invoices:view");
    }
    case "TICKET":
      return c.role === "CLIENT" ? !!(await db.supportTicket.findFirst({ where: { id, clientId: c.clientId ?? "none" }, select: { id: true } })) : c.can("support:view");
    default:
      return false;
  }
}

export async function canOpenDocument(c: Ctx, d: Document): Promise<boolean> {
  if (d.companyId !== c.companyId || d.deletedAt) return false;
  if (c.role === "CLIENT" || c.role === "VENDOR") return d.isPortalVisible && (await canViewEntity(c, d.entityType, d.entityId));
  if (d.uploadedById === c.userId) return true;
  return canViewEntity(c, d.entityType, d.entityId);
}

export async function canUploadTo(c: Ctx, type: string | null, id: string | null): Promise<boolean> {
  if (!c.can("documents:create")) return false;
  return canViewEntity(c, type, id);
}
