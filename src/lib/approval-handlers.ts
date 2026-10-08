import "server-only";
import { registerHandler } from "./approvals";
import { notifyRoles } from "./notify";

/**
 * What happens to each document when its approval is decided.
 * Registered once; import `@/lib/workflow` (not this file) from actions so handlers are always loaded.
 */

registerHandler("QUOTATION", {
  link: (a) => `/sales/quotations/${a.entityId}`,
  onApprove: async (tx, a, c) => {
    const q = await tx.quotation.update({ where: { id: a.entityId }, data: { status: "APPROVED" } });
    // Automation: quotation approved → tell project managers so they can plan capacity
    await notifyRoles(c.companyId, ["PROJECT_MANAGER"], {
      type: "GENERAL", title: `Quotation ${q.number} approved`, body: "A new project may start soon.", link: `/sales/quotations/${q.id}`, dedupeKey: `qt-approved:${q.id}:${q.revision}`,
    }, tx);
  },
  onReject: async (tx, a) => {
    await tx.quotation.update({ where: { id: a.entityId }, data: { status: "REJECTED" } });
  },
});

registerHandler("BOQ", {
  link: (a) => `/sales/boq/${a.entityId}`,
  onApprove: async (tx, a) => {
    await tx.boq.update({ where: { id: a.entityId }, data: { status: "APPROVED" } });
  },
  onReject: async (tx, a) => {
    await tx.boq.update({ where: { id: a.entityId }, data: { status: "DRAFT" } });
  },
});

registerHandler("PURCHASE_REQUEST", {
  link: (a) => `/procurement/requests/${a.entityId}`,
  projectId: async (tx, a) => (await tx.purchaseRequest.findUnique({ where: { id: a.entityId }, select: { projectId: true } }))?.projectId ?? null,
  onApprove: async (tx, a, c) => {
    const pr = await tx.purchaseRequest.update({ where: { id: a.entityId }, data: { status: "APPROVED" } });
    await notifyRoles(c.companyId, ["PROCUREMENT"], {
      type: "PO_PENDING", title: `Purchase request ${pr.number} approved`, body: "Create a purchase order for the approved items.", link: `/procurement/requests/${pr.id}`, dedupeKey: `pr-approved:${pr.id}`,
    }, tx);
  },
  onReject: async (tx, a) => {
    await tx.purchaseRequest.update({ where: { id: a.entityId }, data: { status: "REJECTED" } });
  },
});

registerHandler("PURCHASE_ORDER", {
  link: (a) => `/procurement/orders/${a.entityId}`,
  projectId: async (tx, a) => (await tx.purchaseOrder.findUnique({ where: { id: a.entityId }, select: { projectId: true } }))?.projectId ?? null,
  onApprove: async (tx, a, c) => {
    const po = await tx.purchaseOrder.update({ where: { id: a.entityId }, data: { status: "APPROVED" } });
    await notifyRoles(c.companyId, ["PROCUREMENT"], {
      type: "PO_PENDING", title: `${po.number} approved`, body: "Send it to the vendor.", link: `/procurement/orders/${po.id}`, dedupeKey: `po-approved:${po.id}`,
    }, tx);
  },
  onReject: async (tx, a) => {
    await tx.purchaseOrder.update({ where: { id: a.entityId }, data: { status: "DRAFT" } });
  },
});

registerHandler("INVOICE", {
  link: (a) => `/finance/invoices/${a.entityId}`,
  onApprove: async (tx, a) => {
    await tx.invoice.update({ where: { id: a.entityId }, data: { status: "SENT" } });
  },
  onReject: async (tx, a) => {
    await tx.invoice.update({ where: { id: a.entityId }, data: { status: "DRAFT" } });
  },
});

registerHandler("LEAVE", {
  link: () => "/hr/leaves",
  onApprove: async (tx, a, c) => {
    await tx.leave.update({ where: { id: a.entityId }, data: { status: "APPROVED", decidedById: c.userId } });
  },
  onReject: async (tx, a, c, remarks) => {
    await tx.leave.update({ where: { id: a.entityId }, data: { status: "REJECTED", decidedById: c.userId, decisionNote: remarks ?? null } });
  },
});

registerHandler("EXPENSE", {
  link: () => "/finance/expenses",
  projectId: async (tx, a) => (await tx.expense.findUnique({ where: { id: a.entityId }, select: { projectId: true } }))?.projectId ?? null,
  onApprove: async (tx, a) => {
    await tx.expense.update({ where: { id: a.entityId }, data: { approved: true, rejectedAt: null } });
  },
  onReject: async (tx, a) => {
    await tx.expense.update({ where: { id: a.entityId }, data: { approved: false, rejectedAt: new Date() } });
  },
});
