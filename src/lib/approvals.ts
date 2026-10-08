import "server-only";
import type { Approval, ApprovalType, RoleKey } from "@prisma/client";
import { db, type Tx } from "./db";
import type { Ctx } from "./auth";
import { audit } from "./audit";
import { notifyRoles, notifyUsers } from "./notify";
import { num } from "./utils";
import { UserError } from "./action";

/**
 * Central approval workflow.
 *
 *  - Which role must approve is derived from the amount and the thresholds in Company Settings
 *    (purchases/expenses/vendor payments: ≤ L1 → Project Manager, ≤ L2 → Management, above → Owner).
 *  - Quotations, BOQs, invoices, discounts and budgets always need Management (or the Owner).
 *  - A requester who already has enough authority is auto-approved (no pointless self-approval queues),
 *    but that is still written to the audit log.
 *  - Each document type registers a handler that applies the outcome to its own record.
 */

const THRESHOLD_TYPES: ApprovalType[] = ["PURCHASE_REQUEST", "PURCHASE_ORDER", "EXPENSE", "VENDOR_PAYMENT"];

/** Roles allowed to decide, by the role the workflow requires. */
const DECIDERS: Record<string, RoleKey[]> = {
  PROJECT_MANAGER: ["PROJECT_MANAGER", "MANAGEMENT", "OWNER"],
  MANAGEMENT: ["MANAGEMENT", "OWNER"],
  OWNER: ["OWNER"],
  HR: ["HR", "MANAGEMENT", "OWNER"],
};

export function canDecide(role: RoleKey, required: RoleKey) {
  return (DECIDERS[required] ?? ["OWNER"]).includes(role);
}

export async function requiredRoleFor(companyId: string, type: ApprovalType, amount: number, tx: Tx | typeof db = db): Promise<RoleKey> {
  if (type === "LEAVE") return "HR";
  if (!THRESHOLD_TYPES.includes(type)) return "MANAGEMENT";
  const s = await tx.companySettings.findUnique({ where: { companyId } });
  const l1 = num(s?.approvalLevel1 ?? 25000);
  const l2 = num(s?.approvalLevel2 ?? 100000);
  if (amount <= l1) return "PROJECT_MANAGER";
  if (amount <= l2) return "MANAGEMENT";
  return "OWNER";
}

export type ApprovalHandler = {
  /** Called inside the decision transaction. Update the entity's own status here. */
  onApprove: (tx: Tx, a: Approval, c: Pick<Ctx, "companyId" | "userId" | "name">) => Promise<void>;
  onReject: (tx: Tx, a: Approval, c: Pick<Ctx, "companyId" | "userId" | "name">, remarks?: string) => Promise<void>;
  /** Project the request belongs to (lets a Project Manager approve only their own projects). */
  projectId?: (tx: Tx | typeof db, a: Approval) => Promise<string | null>;
  link: (a: Approval) => string;
};

export const handlers: Partial<Record<ApprovalType, ApprovalHandler>> = {};
export function registerHandler(type: ApprovalType, h: ApprovalHandler) {
  handlers[type] = h;
}

type Req = {
  type: ApprovalType;
  entityType: string;
  entityId: string;
  title: string;
  amount?: number;
};

/**
 * Raise an approval for a document. Returns `{ autoApproved }`. Must be called inside a transaction,
 * after the caller has set the entity to its "pending approval" state.
 */
export async function requestApproval(tx: Tx, c: Ctx, r: Req): Promise<{ approvalId: string; autoApproved: boolean }> {
  const amount = r.amount ?? 0;
  const required = await requiredRoleFor(c.companyId, r.type, amount, tx);

  // cancel any older pending request for the same entity (e.g. resubmission after edits)
  await tx.approval.updateMany({
    where: { companyId: c.companyId, entityType: r.entityType, entityId: r.entityId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), remarks: "Superseded by a new request" },
  });

  const approval = await tx.approval.create({
    data: {
      companyId: c.companyId, type: r.type, entityType: r.entityType, entityId: r.entityId, title: r.title,
      amount, requestedById: c.userId, requiredRole: required,
      steps: { create: { stepNo: 1, role: required } },
    },
  });

  const h = handlers[r.type];
  // Requester has the authority → approve immediately (still audited). A PM only self-approves on their own projects.
  let self = canDecide(c.role, required);
  if (self && required === "PROJECT_MANAGER" && c.role === "PROJECT_MANAGER" && h?.projectId) {
    const pid = await h.projectId(tx, approval);
    const ok = pid ? !!(await tx.project.findFirst({ where: { id: pid, projectManagerId: c.userId }, select: { id: true } })) : false;
    self = ok;
  }
  if (self) {
    await tx.approval.update({ where: { id: approval.id }, data: { status: "APPROVED", decidedById: c.userId, decidedAt: new Date(), remarks: "Auto-approved (within requester's authority)" } });
    await tx.approvalStep.updateMany({ where: { approvalId: approval.id }, data: { status: "APPROVED", userId: c.userId, decidedAt: new Date() } });
    await h?.onApprove(tx, { ...approval, status: "APPROVED" }, c);
    await audit(c, { action: "APPROVE", entityType: r.entityType, entityId: r.entityId, summary: `${r.title} auto-approved (within ${c.name}'s authority)` }, tx);
    return { approvalId: approval.id, autoApproved: true };
  }

  await notifyRoles(c.companyId, DECIDERS[required] ?? ["OWNER"], {
    type: "APPROVAL_PENDING", title: `Approval needed: ${r.title}`,
    body: amount ? `Amount ₹${amount.toLocaleString("en-IN")} · requested by ${c.name}` : `Requested by ${c.name}`,
    link: "/approvals", dedupeKey: `approval:${approval.id}`,
  }, tx);
  await audit(c, { action: "REQUEST_APPROVAL", entityType: r.entityType, entityId: r.entityId, summary: `Requested approval: ${r.title} (needs ${required})` }, tx);
  return { approvalId: approval.id, autoApproved: false };
}

/** Approve/reject. Enforces role, self-approval and (for PM level) project ownership. */
export async function decide(c: Ctx, approvalId: string, approve: boolean, remarks?: string) {
  if (!approve && !remarks?.trim()) throw new UserError("Please say why you are rejecting this.");
  return db.$transaction(async (tx) => {
    const a = await tx.approval.findFirst({ where: { id: approvalId, companyId: c.companyId } });
    if (!a) throw new UserError("Approval request not found.");
    if (a.status !== "PENDING") throw new UserError(`This request is already ${a.status.toLowerCase()}.`);
    if (!canDecide(c.role, a.requiredRole)) throw new UserError(`This needs approval from ${a.requiredRole.replace("_", " ").toLowerCase()} or above.`);
    if (a.requestedById === c.userId && c.role !== "OWNER") throw new UserError("You can't approve your own request.");

    const h = handlers[a.type];
    if (c.role === "PROJECT_MANAGER" && h?.projectId) {
      const pid = await h.projectId(tx, a);
      const mine = pid ? await tx.project.findFirst({ where: { id: pid, projectManagerId: c.userId }, select: { id: true } }) : null;
      if (!mine) throw new UserError("You can only approve requests for projects you manage.");
    }

    const status = approve ? "APPROVED" : "REJECTED";
    await tx.approval.update({ where: { id: a.id }, data: { status, decidedById: c.userId, decidedAt: new Date(), remarks: remarks?.trim() || null } });
    await tx.approvalStep.updateMany({ where: { approvalId: a.id }, data: { status, userId: c.userId, decidedAt: new Date(), remarks: remarks?.trim() || null } });
    if (approve) await h?.onApprove(tx, a, c);
    else await h?.onReject(tx, a, c, remarks);

    await audit(c, {
      action: approve ? "APPROVE" : "REJECT", entityType: a.entityType, entityId: a.entityId,
      summary: `${c.name} ${approve ? "approved" : "rejected"} ${a.title}${remarks ? ` – ${remarks}` : ""}`,
    }, tx);
    await notifyUsers([a.requestedById], {
      companyId: c.companyId, type: "GENERAL", title: `${a.title} was ${approve ? "approved" : "rejected"}`,
      body: remarks ?? undefined, link: h?.link(a) ?? "/approvals",
    }, tx);
    return a;
  });
}
