import "server-only";
import type { TransferRequest } from "@prisma/client";
import type { Tx } from "./db";
import type { Ctx } from "./auth";
import { UserError } from "./action";
import { move, siteLocation } from "./inventory";
import { nextNumber } from "./sequence";
import { notifyRoles, notifyUsers } from "./notify";

export type MaterialLine = { materialId: string; quantity: number };
export type ManpowerLine = { workerId: string };

const WIDE = ["OWNER", "MANAGEMENT", "ADMIN"];

/**
 * Who may approve a transfer (SOP: the concerned Project Manager's approval is mandatory; in an emergency the
 * Project Director approves and the PM is informed). Management/Owner/Admin may always approve.
 */
export function canDecideTransfer(c: Pick<Ctx, "role" | "userId">, fromProjectManagerId: string | null): boolean {
  if (WIDE.includes(c.role)) return true;
  return c.role === "PROJECT_MANAGER" && fromProjectManagerId === c.userId;
}

/** Carries out an approved transfer: stock moves between the two site stores and project cost moves with it. */
export async function executeTransfer(tx: Tx, c: Pick<Ctx, "companyId" | "userId">, t: TransferRequest): Promise<string> {
  const [from, to] = await Promise.all([
    tx.project.findUniqueOrThrow({ where: { id: t.fromProjectId }, select: { code: true, name: true, projectManagerId: true } }),
    tx.project.findUniqueOrThrow({ where: { id: t.toProjectId }, select: { code: true, name: true, projectManagerId: true } }),
  ]);

  if (t.kind === "MATERIAL") {
    const lines = t.items as unknown as MaterialLine[];
    const siteA = await siteLocation(tx, c.companyId, t.fromProjectId);
    const siteB = await siteLocation(tx, c.companyId, t.toProjectId);
    const outNo = await nextNumber(tx, c.companyId, "MIN");
    const inNo = await nextNumber(tx, c.companyId, "MIN");
    const out = await tx.materialIssue.create({ data: { companyId: c.companyId, number: outNo, projectId: t.fromProjectId, fromLocationId: siteA, toLocationId: siteB, issuedById: c.userId, purpose: `TRANSFER OUT ${t.number} to ${to.code}` } });
    const inn = await tx.materialIssue.create({ data: { companyId: c.companyId, number: inNo, projectId: t.toProjectId, fromLocationId: siteA, toLocationId: siteB, issuedById: c.userId, purpose: `TRANSFER IN ${t.number} from ${from.code}` } });
    for (const l of lines) {
      const { unitCost } = await move(tx, c, { type: "TRANSFER", materialId: l.materialId, quantity: l.quantity, fromLocationId: siteA, toLocationId: siteB, projectId: t.toProjectId, refType: "TRANSFER", refId: t.id, note: `${t.number}: ${from.code} → ${to.code}` });
      // the cost leaves the first project (credit) and lands on the second (charge) at the same rate
      await tx.materialIssueItem.create({ data: { issueId: out.id, materialId: l.materialId, quantity: -l.quantity, unitCost } });
      await tx.materialIssueItem.create({ data: { issueId: inn.id, materialId: l.materialId, quantity: l.quantity, unitCost } });
    }
    return `${lines.length} material line(s) moved from ${from.code} to ${to.code}`;
  }

  const workers = (t.items as unknown as ManpowerLine[]).map((w) => w.workerId);
  const moved = await tx.worker.updateMany({ where: { id: { in: workers }, companyId: c.companyId, currentProjectId: t.fromProjectId }, data: { currentProjectId: t.toProjectId } });
  if (moved.count !== workers.length) throw new UserError("Some workers are no longer on the first project, so the transfer can't be completed. Please raise a new request.");
  return `${moved.count} worker(s) moved from ${from.code} to ${to.code}`;
}

/** Tells everyone SOP says must know: both project managers and, for material, Procurement and Accounts. */
export async function announceTransfer(tx: Tx, c: Pick<Ctx, "companyId" | "userId">, t: TransferRequest, outcome: "approved" | "rejected" | "pending", fromPm: string | null, toPm: string | null, summary: string) {
  const link = "/transfers";
  const what = t.kind === "MATERIAL" ? "Material" : "Manpower";
  const base = { companyId: c.companyId, type: "GENERAL" as const, link };
  if (outcome === "pending") {
    const who = fromPm ? [fromPm] : [];
    if (who.length) await notifyUsers(who.filter((u) => u !== t.requestedById), { ...base, title: `${what} transfer ${t.number} needs your approval${t.emergency ? " (EMERGENCY)" : ""}`, body: t.reason ?? undefined }, tx);
    await notifyRoles(c.companyId, ["MANAGEMENT"], { ...base, title: `${what} transfer ${t.number} waiting for approval`, body: t.reason ?? undefined }, tx);
    return;
  }
  const ids = [t.requestedById, fromPm, toPm].filter((u): u is string => !!u && u !== c.userId);
  await notifyUsers(ids, { ...base, title: `${what} transfer ${t.number} ${outcome}`, body: summary }, tx);
  if (outcome === "approved" && t.kind === "MATERIAL") await notifyRoles(c.companyId, ["PROCUREMENT", "ACCOUNTS"], { ...base, title: `Material transferred between projects (${t.number})`, body: summary }, tx);
}

export const describeLines = (t: Pick<TransferRequest, "kind" | "items">) =>
  t.kind === "MATERIAL" ? `${(t.items as unknown as MaterialLine[]).length} material line(s)` : `${(t.items as unknown as ManpowerLine[]).length} worker(s)`;
