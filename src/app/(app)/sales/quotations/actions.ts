"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BoqCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextDocNumber, nextNumber } from "@/lib/sequence";
import { requestApproval } from "@/lib/workflow";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { computeTotals, boqItemTotals } from "@/lib/money";
import { formToObject, zDate, zNumPos, zOptDate, zOptStr, zReqStr } from "@/lib/form";
import { leadScope } from "@/lib/scope";
import { humanize, num } from "@/lib/utils";

const itemSchema = z.object({
  category: z.nativeEnum(BoqCategory).default("OTHER"),
  description: zReqStr("Describe each line"),
  unit: z.string().trim().min(1).default("nos"),
  quantity: z.coerce.number({ message: "Enter a quantity" }).positive("Quantity must be above 0"),
  rate: z.coerce.number({ message: "Enter a rate" }).min(0, "Rate can't be negative"),
  taxPercent: z.coerce.number().min(0).max(100).default(18),
});

const headerSchema = z.object({
  clientId: zReqStr("Select a client"),
  leadId: zOptStr,
  title: zOptStr,
  date: zDate("Pick a date"),
  validUntil: zOptDate,
  terms: zOptStr,
  paymentTerms: zOptStr,
  notes: zOptStr,
  discountPct: zNumPos().max(100, "Max 100%").default(0),
});

function parseItems(raw: unknown) {
  let arr: unknown;
  try {
    arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new UserError("Line items could not be read. Please reload the page.");
  }
  const parsed = z.array(itemSchema).min(1, "Add at least one line item").safeParse(arr);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  return parsed.data;
}

const EDITABLE = ["DRAFT", "REJECTED"] as const;

async function load(c: Ctx, id: string) {
  const q = await db.quotation.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!q) throw new UserError("Quotation not found.");
  return q;
}

function buildItemRows(items: z.infer<typeof itemSchema>[], discountPct: number) {
  const t = computeTotals(items.map((i) => ({ quantity: i.quantity, rate: i.rate, taxPercent: i.taxPercent })), { pct: discountPct });
  return { t, rows: items.map((i, idx) => ({ sortOrder: idx, category: i.category, description: i.description, unit: i.unit, quantity: i.quantity, rate: i.rate, taxPercent: i.taxPercent, amount: t.lines[idx].amount })) };
}

export async function createQuotation(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("quotations:create");
    const raw = formToObject(fd);
    const h = headerSchema.parse(raw);
    const items = parseItems(raw.items);
    const client = await db.client.findFirst({ where: { id: h.clientId, companyId: c.companyId, deletedAt: null } });
    if (!client) throw new UserError("Client not found.");
    if (h.leadId) {
      const lead = await db.lead.findFirst({ where: { id: h.leadId, ...leadScope(c) } });
      if (!lead) throw new UserError("Lead not found or not yours.");
    }
    const { t, rows } = buildItemRows(items, h.discountPct);
    const q = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, c.companyId, "quotation");
      const x = await tx.quotation.create({
        data: {
          companyId: c.companyId, number, clientId: h.clientId, leadId: h.leadId ?? null, title: h.title, date: h.date, validUntil: h.validUntil,
          preparedById: c.userId, terms: h.terms, paymentTerms: h.paymentTerms, notes: h.notes, discountPct: h.discountPct,
          subtotal: t.subtotal, discountAmount: t.discount, taxAmount: t.tax, total: t.total, items: { create: rows },
        },
      });
      if (h.leadId) {
        await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: h.leadId, kind: "NOTE", userId: c.userId, body: `Quotation ${number} drafted (₹${t.total.toLocaleString("en-IN")})` } });
        await tx.lead.updateMany({ where: { id: h.leadId, stage: { in: ["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT_SCHEDULED", "SITE_VISIT_COMPLETED"] } }, data: { stage: "PROPOSAL_IN_PROGRESS" } });
      }
      await audit(c, { action: "CREATE", entityType: "Quotation", entityId: x.id, summary: `Created quotation ${number} for ${client.name} – ₹${t.total.toLocaleString("en-IN")}`, newValue: { total: t.total, items: rows.length } }, tx);
      return x;
    });
    revalidatePath("/sales/quotations");
    return { message: `Quotation ${q.number} saved`, data: { id: q.id } };
  });
}

export async function updateQuotation(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("quotations:edit");
    const old = await load(c, id);
    if (!(EDITABLE as readonly string[]).includes(old.status)) throw new UserError("This quotation has been approved or sent. Use “Revise” to make changes.");
    const raw = formToObject(fd);
    const h = headerSchema.parse(raw);
    const items = parseItems(raw.items);
    const { t, rows } = buildItemRows(items, h.discountPct);
    await db.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      await tx.quotation.update({
        where: { id },
        data: {
          clientId: h.clientId, leadId: h.leadId ?? null, title: h.title, date: h.date, validUntil: h.validUntil, terms: h.terms, paymentTerms: h.paymentTerms, notes: h.notes,
          discountPct: h.discountPct, subtotal: t.subtotal, discountAmount: t.discount, taxAmount: t.tax, total: t.total, status: "DRAFT",
          items: { create: rows },
        },
      });
      const changed = num(old.total) !== t.total;
      await audit(c, {
        action: "UPDATE", entityType: "Quotation", entityId: id,
        summary: changed ? `${c.name} changed quotation ${old.number} from ₹${num(old.total).toLocaleString("en-IN")} to ₹${t.total.toLocaleString("en-IN")}` : `Updated quotation ${old.number}`,
        oldValue: { total: num(old.total) }, newValue: { total: t.total },
      }, tx);
    });
    revalidatePath("/sales/quotations");
    revalidatePath(`/sales/quotations/${id}`);
    return { message: "Quotation saved", data: { id } };
  });
}

export async function submitQuotation(id: string) {
  return run(async () => {
    const c = await assertPerm("quotations:edit");
    const q = await load(c, id);
    if (!["DRAFT", "REJECTED"].includes(q.status)) throw new UserError("Only draft quotations can be submitted for approval.");
    if (q.items.length === 0 || num(q.total) <= 0) throw new UserError("Add line items with a value before submitting.");
    const r = await db.$transaction(async (tx) => {
      await tx.quotation.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      return requestApproval(tx, c, { type: "QUOTATION", entityType: "Quotation", entityId: id, title: `Quotation ${q.number}`, amount: num(q.total) });
    });
    revalidatePath("/sales/quotations");
    revalidatePath(`/sales/quotations/${id}`);
    return { message: r.autoApproved ? "Approved (within your authority)" : "Sent for approval" };
  });
}

export async function markQuotationSent(id: string) {
  return run(async () => {
    const c = await assertPerm("quotations:edit");
    const q = await load(c, id);
    if (q.status !== "APPROVED") throw new UserError("Only approved quotations can be sent to the client.");
    await db.$transaction(async (tx) => {
      await tx.quotation.update({ where: { id }, data: { status: "SENT" } });
      if (q.leadId) {
        await tx.lead.updateMany({ where: { id: q.leadId, stage: { notIn: ["WON", "LOST"] } }, data: { stage: "QUOTATION_SENT" } });
        await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: q.leadId, kind: "NOTE", userId: c.userId, body: `Quotation ${q.number} sent to client` } });
      }
      await audit(c, { action: "UPDATE", entityType: "Quotation", entityId: id, summary: `Marked quotation ${q.number} as sent` }, tx);
    });
    revalidatePath("/sales/quotations");
    revalidatePath(`/sales/quotations/${id}`);
    return { message: "Marked as sent" };
  });
}

const NEXT: Record<string, string[]> = {
  SENT: ["VIEWED", "NEGOTIATION", "ACCEPTED", "REJECTED"],
  VIEWED: ["NEGOTIATION", "ACCEPTED", "REJECTED"],
  NEGOTIATION: ["ACCEPTED", "REJECTED"],
};

export async function setQuotationStatus(id: string, status: string) {
  return run(async () => {
    const c = await assertPerm("quotations:edit");
    const q = await load(c, id);
    if (!NEXT[q.status]?.includes(status)) throw new UserError(`A ${humanize(q.status)} quotation can't be moved to ${humanize(status)}.`);
    await db.$transaction(async (tx) => {
      await tx.quotation.update({ where: { id }, data: { status: status as never } });
      if (q.leadId) {
        if (status === "ACCEPTED") {
          await tx.lead.update({ where: { id: q.leadId }, data: { stage: "WON", clientId: q.clientId } });
          await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: q.leadId, kind: "STAGE_CHANGE", userId: c.userId, body: `Quotation ${q.number} accepted → Won` } });
        } else if (status === "NEGOTIATION") {
          await tx.lead.updateMany({ where: { id: q.leadId, stage: { notIn: ["WON", "LOST"] } }, data: { stage: "NEGOTIATION" } });
        }
      }
      await audit(c, { action: "UPDATE", entityType: "Quotation", entityId: id, summary: `Quotation ${q.number}: ${humanize(q.status)} → ${humanize(status)}` }, tx);
      if (status === "ACCEPTED") {
        await notifyRoles(c.companyId, ["MANAGEMENT", "OWNER", "PROJECT_MANAGER"], { type: "GENERAL", title: `Quotation ${q.number} accepted 🎉`, body: "Convert it into a project to start execution.", link: `/sales/quotations/${id}`, dedupeKey: `qt-accepted:${id}` }, tx);
      }
    });
    revalidatePath("/sales/quotations");
    revalidatePath(`/sales/quotations/${id}`);
    return { message: `Marked ${humanize(status)}` };
  });
}

/** Creates a new revision: snapshot of the current version is kept, number stays, status returns to Draft. */
export async function reviseQuotation(id: string, fd?: FormData) {
  return run(async () => {
    const c = await assertPerm("quotations:edit");
    const q = await load(c, id);
    if (q.projectId) throw new UserError("This quotation has already been converted to a project and can't be revised.");
    if (q.status === "DRAFT") throw new UserError("It's already a draft – just edit it.");
    if (q.status === "PENDING_APPROVAL") throw new UserError("Wait for the approval decision, or ask the approver to reject it first.");
    const reason = fd ? String(fd.get("reason") ?? "").trim() : "";
    await db.$transaction(async (tx) => {
      await tx.quotationRevision.create({
        data: {
          quotationId: id, revision: q.revision, total: q.total, reason: reason || null, createdById: c.userId,
          snapshot: { status: q.status, subtotal: num(q.subtotal), discountAmount: num(q.discountAmount), taxAmount: num(q.taxAmount), total: num(q.total), items: q.items.map((i) => ({ description: i.description, unit: i.unit, quantity: num(i.quantity), rate: num(i.rate), taxPercent: num(i.taxPercent), amount: num(i.amount) })) },
        },
      });
      await tx.quotation.update({ where: { id }, data: { revision: { increment: 1 }, status: "DRAFT" } });
      await audit(c, { action: "UPDATE", entityType: "Quotation", entityId: id, summary: `Revised quotation ${q.number} → revision ${q.revision + 1}${reason ? ` (${reason})` : ""}` }, tx);
    });
    revalidatePath(`/sales/quotations/${id}`);
    return { message: `Revision ${q.revision + 1} started` };
  });
}

export async function deleteQuotation(id: string) {
  return run(async () => {
    const c = await assertPerm("quotations:delete");
    const q = await load(c, id);
    if (!["DRAFT", "REJECTED", "EXPIRED"].includes(q.status)) throw new UserError("Only draft, rejected or expired quotations can be deleted.");
    await db.quotation.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(c, { action: "DELETE", entityType: "Quotation", entityId: id, summary: `Deleted quotation ${q.number}` });
    revalidatePath("/sales/quotations");
    return { message: "Quotation deleted" };
  });
}

const convertSchema = z.object({
  name: zOptStr,
  projectManagerId: zReqStr("Choose a project manager"),
  designerId: zOptStr,
  siteAddress: zOptStr,
  startDate: zOptDate,
  plannedEndDate: zOptDate,
});

/** Accepted quotation → Project + draft BOQ (selling rates carried over; costs to be filled by the PM). */
export async function convertQuotationToProject(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("projects:create");
    const d = convertSchema.parse(formToObject(fd));
    const q = await load(c, id);
    if (q.status !== "ACCEPTED") throw new UserError("Only accepted quotations can be converted to a project.");
    if (q.projectId) throw new UserError("This quotation is already linked to a project.");
    const pm = await db.user.findFirst({ where: { id: d.projectManagerId, companyId: c.companyId, role: { in: ["PROJECT_MANAGER", "MANAGEMENT", "OWNER"] }, isActive: true } });
    if (!pm) throw new UserError("Choose a valid project manager.");
    const client = await db.client.findUniqueOrThrow({ where: { id: q.clientId } });
    const lead = q.leadId ? await db.lead.findUnique({ where: { id: q.leadId } }) : null;

    const result = await db.$transaction(async (tx) => {
      const code = await nextNumber(tx, c.companyId, "PRJ");
      const contractValue = num(q.subtotal) - num(q.discountAmount);
      const project = await tx.project.create({
        data: {
          companyId: c.companyId, code, name: d.name || q.title || `${client.name} – ${lead?.projectType ?? "Interior"}`, clientId: q.clientId,
          segment: lead?.segment ?? "RESIDENTIAL", siteAddress: d.siteAddress ?? lead?.location ?? client.address, startDate: d.startDate, plannedEndDate: d.plannedEndDate,
          projectManagerId: d.projectManagerId, designerId: d.designerId, contractValue, status: "APPROVED", quotationId: q.id,
        },
      });
      const boqNumber = await nextNumber(tx, c.companyId, "BOQ");
      const items = q.items.map((i, idx) => {
        const tot = boqItemTotals({ quantity: num(i.quantity), materialCost: 0, labourCost: 0, otherCost: 0, sellingRate: num(i.rate) });
        return { sortOrder: idx, category: i.category, item: i.description.slice(0, 160), description: i.description.length > 160 ? i.description : null, unit: i.unit, quantity: i.quantity, sellingRate: i.rate, estimatedCost: tot.estimatedCost, total: tot.total };
      });
      const boq = await tx.boq.create({ data: { companyId: c.companyId, number: boqNumber, projectId: project.id, quotationId: q.id, title: `${project.name} – BOQ`, items: { create: items } } });
      await tx.quotation.update({ where: { id }, data: { projectId: project.id, boqId: boq.id } });
      await tx.projectMember.create({ data: { projectId: project.id, userId: d.projectManagerId, roleLabel: "Project Manager" } });
      await notifyUsers([d.projectManagerId], { companyId: c.companyId, type: "GENERAL", title: `New project assigned: ${project.name}`, body: "Review the BOQ and fill in the estimated costs.", link: `/projects/${project.id}` }, tx);
      await audit(c, { action: "CREATE", entityType: "Project", entityId: project.id, summary: `Converted quotation ${q.number} into project ${code} (contract ₹${contractValue.toLocaleString("en-IN")}) with BOQ ${boqNumber}` }, tx);
      return { project, boq };
    });
    revalidatePath("/sales/quotations");
    revalidatePath(`/sales/quotations/${id}`);
    revalidatePath("/projects");
    return { message: `Project ${result.project.code} created`, data: { projectId: result.project.id, boqId: result.boq.id } };
  });
}

/** BOQ → draft Quotation using the BOQ's selling rates (cost columns are never copied). */
export async function createQuotationFromBoq(boqId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("quotations:create");
    const clientId = String(fd.get("clientId") ?? "");
    if (!clientId) throw new UserError("Select a client.");
    const boq = await db.boq.findFirst({ where: { id: boqId, companyId: c.companyId, deletedAt: null }, include: { items: { orderBy: { sortOrder: "asc" } } } });
    if (!boq) throw new UserError("BOQ not found.");
    if (boq.items.length === 0) throw new UserError("This BOQ has no items.");
    const settings = await db.companySettings.findUnique({ where: { companyId: c.companyId } });
    const tax = num(settings?.defaultTaxPercent ?? 18);
    const items = boq.items.map((i) => ({ q: num(i.quantity), r: num(i.sellingRate), t: tax }));
    const t = computeTotals(items.map((i) => ({ quantity: i.q, rate: i.r, taxPercent: i.t })));
    const quotation = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, c.companyId, "quotation");
      const defaultTerms = await tx.termsAndConditions.findFirst({ where: { companyId: c.companyId, kind: "QUOTATION", isDefault: true } });
      const x = await tx.quotation.create({
        data: {
          companyId: c.companyId, number, clientId, boqId: boq.id, title: boq.title, preparedById: c.userId, terms: defaultTerms?.body,
          subtotal: t.subtotal, discountAmount: 0, taxAmount: t.tax, total: t.total,
          items: { create: boq.items.map((i, idx) => ({ sortOrder: idx, category: i.category, description: [i.item, i.specification].filter(Boolean).join(" – "), unit: i.unit, quantity: i.quantity, rate: i.sellingRate, taxPercent: tax, amount: t.lines[idx].amount })) },
        },
      });
      await audit(c, { action: "CREATE", entityType: "Quotation", entityId: x.id, summary: `Created quotation ${number} from BOQ ${boq.number}` }, tx);
      return x;
    });
    revalidatePath("/sales/quotations");
    return { message: `Quotation ${quotation.number} created from BOQ`, data: { id: quotation.id } };
  });
}

