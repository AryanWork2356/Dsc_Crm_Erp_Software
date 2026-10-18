"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, TransferKind } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextNumber } from "@/lib/sequence";
import { projectScope } from "@/lib/scope";
import { announceTransfer, canDecideTransfer, executeTransfer } from "@/lib/transfers";
import { formToObject, zOptStr, zReqStr } from "@/lib/form";
import { num } from "@/lib/utils";

const schema = z.object({
  kind: z.enum(["MATERIAL", "MANPOWER"]),
  fromProjectId: zReqStr("Choose the project the material or workers are leaving"),
  toProjectId: zReqStr("Choose the project they are going to"),
  reason: zOptStr,
  emergency: z.boolean().default(false),
});
const materialLine = z.object({ materialId: z.string().min(1), quantity: z.coerce.number({ message: "Enter a quantity" }).positive("Quantity must be above 0") });
const workerLine = z.object({ workerId: z.string().min(1) });

function parseJson<T>(raw: unknown, s: z.ZodType<T>): T {
  let v: unknown;
  try {
    v = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new UserError("The list could not be read. Please reload the page.");
  }
  const p = s.safeParse(v);
  if (!p.success) throw new UserError(p.error.issues[0]?.message ?? "Check the list.");
  return p.data;
}

/** SOP: moving material or manpower to another project needs the approval of the project it leaves. */
export async function createTransfer(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("transfers:create");
    const raw = formToObject(fd);
    const d = schema.parse(raw);
    if (d.fromProjectId === d.toProjectId) throw new UserError("Choose two different projects.");
    const open = { notIn: ["COMPLETED", "CANCELLED"] as ("COMPLETED" | "CANCELLED")[] };
    const [from, to] = await Promise.all([
      db.project.findFirst({ where: { id: d.fromProjectId, ...projectScope(c), status: open } }),
      db.project.findFirst({ where: { id: d.toProjectId, companyId: c.companyId, deletedAt: null, status: open } }),
    ]);
    if (!from) throw new UserError("The first project wasn't found, is closed, or you aren't on it.");
    if (!to) throw new UserError("The second project wasn't found or is closed.");

    let items: Prisma.InputJsonValue;
    if (d.kind === "MATERIAL") {
      const lines = parseJson(raw.items, z.array(materialLine).min(1, "Add at least one material"));
      if (new Set(lines.map((l) => l.materialId)).size !== lines.length) throw new UserError("A material appears twice. Combine the quantities.");
      const site = await db.warehouse.findFirst({ where: { companyId: c.companyId, projectId: from.id, type: "SITE" } });
      const bal = site ? await db.stockBalance.findMany({ where: { locationId: site.id, materialId: { in: lines.map((l) => l.materialId) } }, include: { material: { select: { name: true, unit: true } } } }) : [];
      for (const l of lines) {
        const b = bal.find((x) => x.materialId === l.materialId);
        const have = b ? num(b.quantity) - num(b.reserved) : 0;
        if (have < l.quantity) {
          const m = b?.material ?? (await db.material.findUnique({ where: { id: l.materialId }, select: { name: true, unit: true } }));
          throw new UserError(`${m?.name ?? "That material"}: only ${have} ${m?.unit ?? ""} at ${from.code}'s site store, you asked for ${l.quantity}.`);
        }
      }
      items = lines;
    } else {
      const lines = parseJson(raw.items, z.array(workerLine).min(1, "Choose at least one worker"));
      const ids = [...new Set(lines.map((l) => l.workerId))];
      const workers = await db.worker.findMany({ where: { id: { in: ids }, companyId: c.companyId, isActive: true, deletedAt: null } });
      if (workers.length !== ids.length) throw new UserError("A chosen worker wasn't found or is inactive.");
      const away = workers.find((w) => w.currentProjectId !== from.id);
      if (away) throw new UserError(`${away.name} is not working on ${from.code} right now.`);
      items = ids.map((workerId) => ({ workerId }));
    }

    // the concerned PM (or Management) raising it is the approval; otherwise it waits for them
    const selfApproves = canDecideTransfer(c, from.projectManagerId);
    const out = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, c.companyId, "TR");
      let t = await tx.transferRequest.create({ data: { companyId: c.companyId, number, kind: d.kind as TransferKind, fromProjectId: from.id, toProjectId: to.id, requestedById: c.userId, reason: d.reason, items, emergency: d.emergency } });
      let summary = "";
      if (selfApproves) {
        summary = await executeTransfer(tx, c, t);
        t = await tx.transferRequest.update({ where: { id: t.id }, data: { status: "APPROVED", decidedById: c.userId, decidedAt: new Date(), decisionNote: "Approved on request (requester has authority)" } });
        await announceTransfer(tx, c, t, "approved", from.projectManagerId, to.projectManagerId, summary);
      } else {
        await announceTransfer(tx, c, t, "pending", from.projectManagerId, to.projectManagerId, "");
      }
      await audit(c, { action: "CREATE", entityType: "TransferRequest", entityId: t.id, summary: `${selfApproves ? "Transferred" : "Requested transfer of"} ${d.kind.toLowerCase()} ${from.code} → ${to.code} (${number})${d.emergency ? " – emergency" : ""}` }, tx);
      return { t, summary };
    });
    revalidatePath("/transfers");
    return { message: selfApproves ? `Done – ${out.summary}` : `Request ${out.t.number} sent to the project manager for approval`, data: { id: out.t.id } };
  });
}

export async function decideTransfer(id: string, approve: boolean, fd?: FormData) {
  return run(async () => {
    const c = await assertPerm("transfers:approve");
    const note = String(fd?.get("note") ?? "").trim();
    if (!approve && !note) throw new UserError("Write the reason for rejecting.");
    const t = await db.transferRequest.findFirst({ where: { id, companyId: c.companyId } });
    if (!t) throw new UserError("Transfer not found.");
    if (t.status !== "PENDING") throw new UserError("This transfer has already been decided.");
    const [from, to] = await Promise.all([db.project.findUniqueOrThrow({ where: { id: t.fromProjectId } }), db.project.findUniqueOrThrow({ where: { id: t.toProjectId } })]);
    if (!canDecideTransfer(c, from.projectManagerId)) throw new UserError(`Only the project manager of ${from.code}, or Management, can decide this.`);
    if (t.requestedById === c.userId && c.role !== "OWNER") throw new UserError("You can't approve your own request.");

    const msg = await db.$transaction(async (tx) => {
      const fresh = await tx.transferRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: c.userId, decidedAt: new Date(), decisionNote: note || null } });
      if (fresh.count !== 1) throw new UserError("This transfer has already been decided.");
      const upd = await tx.transferRequest.findUniqueOrThrow({ where: { id } });
      const summary = approve ? await executeTransfer(tx, c, upd) : note;
      await announceTransfer(tx, c, upd, approve ? "approved" : "rejected", from.projectManagerId, to.projectManagerId, summary);
      await audit(c, { action: approve ? "APPROVE" : "REJECT", entityType: "TransferRequest", entityId: id, summary: `${approve ? "Approved" : "Rejected"} transfer ${t.number}${note ? `: ${note}` : ""}` }, tx);
      return summary;
    });
    revalidatePath("/transfers");
    return { message: approve ? `Approved – ${msg}` : "Rejected" };
  });
}
