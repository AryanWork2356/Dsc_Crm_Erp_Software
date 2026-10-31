import "server-only";
import type { Document } from "@prisma/client";
import { db } from "./db";
import type { Ctx } from "./auth";
import { projectDocScope, projectScope, clientScope, leadScope } from "./scope";

/**
 * Who may open a document. A document inherits the visibility of the record it is attached to:
 *   PROJECT/QUOTATION/BOQ → project access, CLIENT/LEAD → CRM scope, EMPLOYEE → HR only,
 *   VENDOR/PO → procurement, INVOICE → finance. Portal users only get files explicitly shared with them.
 */

export const ENTITY_TYPES = ["CLIENT", "LEAD", "PROJECT", "EMPLOYEE", "VENDOR", "QUOTATION", "PO", "INVOICE", "BOQ", "SITE_VISIT", "TICKET", "EXPENSE", "VENDOR_BILL", "PURCHASE_REQUEST", "GENERAL"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

const STAFF_ALL = ["OWNER", "MANAGEMENT", "ADMIN"];
/** Roles that see every purchase request (others: their own, and their projects'). */
export const PR_ALL = ["OWNER", "MANAGEMENT", "ADMIN", "PROCUREMENT", "ACCOUNTS"];

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
    case "EXPENSE": {
      if (!c.can("expenses:view")) return false;
      const e = await db.expense.findFirst({ where: { id, companyId: c.companyId }, select: { createdById: true, projectId: true } });
      if (!e) return false;
      if (c.can("finance:view") || STAFF_ALL.includes(c.role) || e.createdById === c.userId) return true;
      return !!e.projectId && !!(await db.project.findFirst({ where: { id: e.projectId, ...projectDocScope(c) }, select: { id: true } }));
    }
    case "PURCHASE_REQUEST": {
      // the voice note on a request: whoever can open the request
      const pr = await db.purchaseRequest.findFirst({ where: { id, companyId: c.companyId }, select: { requestedById: true, projectId: true } });
      if (!pr || !c.can("purchase_requests:view")) return false;
      if (PR_ALL.includes(c.role) || pr.requestedById === c.userId) return true;
      return !!pr.projectId && !!(await db.project.findFirst({ where: { id: pr.projectId, ...projectScope(c) }, select: { id: true } }));
    }
    case "VENDOR_BILL":
      return c.can("vendor_bills:view") && !!(await db.vendorBill.findFirst({ where: { id, companyId: c.companyId }, select: { id: true } }));
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

/**
 * DSC rule for a project's files: anyone on the project may UPLOAD, but only directors open them. Two folders are for the whole
 * project team: "Downloadables" (drawings and files the directors share with the site) and the daily report photos and voice notes.
 */
export const DOWNLOADS_FOLDER = "Downloadables";
export const REPORT_FOLDER = "Daily reports";
export const isDirector = (c: Pick<Ctx, "role">) => c.role === "OWNER" || c.role === "MANAGEMENT";
/** Who may put files in Downloadables: directors and admins. */
export const canShareDownloads = (c: Pick<Ctx, "role">) => isDirector(c) || c.role === "ADMIN";
export const teamFolder = (folder: string | null) => folder === DOWNLOADS_FOLDER || folder === REPORT_FOLDER;

export async function canOpenDocument(c: Ctx, d: Document): Promise<boolean> {
  if (d.companyId !== c.companyId || d.deletedAt) return false;
  if (c.role === "CLIENT" || c.role === "VENDOR") return d.isPortalVisible && (await canViewEntity(c, d.entityType, d.entityId));
  if (d.entityType === "PROJECT" && !isDirector(c) && !teamFolder(d.folder)) return false; // directors only, even for the person who uploaded it
  if (d.uploadedById === c.userId) return true;
  return canViewEntity(c, d.entityType, d.entityId);
}

export async function canUploadTo(c: Ctx, type: string | null, id: string | null): Promise<boolean> {
  if (!c.can("documents:create")) return false;
  return canViewEntity(c, type, id);
}
