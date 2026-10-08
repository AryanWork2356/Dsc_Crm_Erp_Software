"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LeadStage, Priority, SegmentType } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextNumber } from "@/lib/sequence";
import { notifyUsers } from "@/lib/notify";
import { leadScope, clientScope } from "@/lib/scope";
import { formToObject, zDate, zEmail, zGstin, zOptDate, zOptNum, zOptStr, zPan, zPhone, zReqStr } from "@/lib/form";
import { humanize } from "@/lib/utils";

// ───────────── helpers ─────────────
async function getLead(c: Ctx, id: string, tx: Tx | typeof db = db) {
  const lead = await tx.lead.findFirst({ where: { id, ...leadScope(c) } });
  if (!lead) throw new UserError("Lead not found or you don't have access to it.");
  return lead;
}

/** Least-loaded salesperson (fewest open leads) – used for automatic assignment of new leads. */
async function autoAssignee(tx: Tx, companyId: string): Promise<string | null> {
  const sales = await tx.user.findMany({ where: { companyId, role: "SALES", isActive: true, deletedAt: null }, select: { id: true } });
  if (!sales.length) return null;
  const counts = await tx.lead.groupBy({
    by: ["assignedToId"],
    where: { companyId, deletedAt: null, stage: { notIn: ["WON", "LOST", "ON_HOLD"] }, assignedToId: { in: sales.map((s) => s.id) } },
    _count: true,
  });
  const load = new Map(counts.map((c) => [c.assignedToId, c._count]));
  return sales.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0].id;
}

// ───────────── LEADS ─────────────
const leadSchema = z.object({
  name: zReqStr("Name is required"),
  companyName: zOptStr,
  phone: zPhone,
  whatsapp: zPhone,
  email: zEmail,
  source: zOptStr,
  segment: z.nativeEnum(SegmentType).default("RESIDENTIAL"),
  projectType: zOptStr,
  location: zOptStr,
  estimatedValue: zOptNum,
  requirement: zOptStr,
  assignedToId: zOptStr,
  priority: z.nativeEnum(Priority).default("MEDIUM"),
  nextFollowUp: zOptDate,
  notes: zOptStr,
});

export async function createLead(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("leads:create");
    const d = leadSchema.parse(formToObject(fd));
    const lead = await db.$transaction(async (tx) => {
      // Sales users own the leads they create; managers can pick or leave it to auto-assign.
      const assignedToId = c.role === "SALES" ? c.userId : d.assignedToId || (await autoAssignee(tx, c.companyId));
      const code = await nextNumber(tx, c.companyId, "LD");
      const l = await tx.lead.create({
        data: { ...d, companyId: c.companyId, code, assignedToId: assignedToId ?? null },
      });
      await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: l.id, kind: "NOTE", body: "Lead created", userId: c.userId } });
      await audit(c, { action: "CREATE", entityType: "Lead", entityId: l.id, summary: `Created lead ${code} – ${d.name}`, newValue: d }, tx);
      if (l.assignedToId && l.assignedToId !== c.userId) {
        await notifyUsers([l.assignedToId], { companyId: c.companyId, type: "GENERAL", title: `New lead assigned: ${d.name}`, body: d.requirement ?? undefined, link: `/crm/leads/${l.id}` }, tx);
      }
      return l;
    });
    revalidatePath("/crm/leads");
    return { message: `Lead ${lead.code} created`, data: { id: lead.id } };
  });
}

export async function updateLead(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("leads:edit");
    const d = leadSchema.parse(formToObject(fd));
    const old = await getLead(c, id);
    if (c.role === "SALES") d.assignedToId = old.assignedToId ?? undefined; // sales can't reassign
    const reassigned = !!d.assignedToId && d.assignedToId !== old.assignedToId;
    await db.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: { ...d, assignedToId: d.assignedToId ?? null } });
      await audit(c, { action: "UPDATE", entityType: "Lead", entityId: id, summary: `Updated lead ${old.code} – ${old.name}`, oldValue: { name: old.name, phone: old.phone, estimatedValue: old.estimatedValue, assignedToId: old.assignedToId }, newValue: d }, tx);
      if (reassigned) {
        await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: id, kind: "NOTE", body: "Lead reassigned", userId: c.userId } });
        await notifyUsers([d.assignedToId!], { companyId: c.companyId, type: "GENERAL", title: `Lead assigned to you: ${old.name}`, link: `/crm/leads/${id}` }, tx);
      }
    });
    revalidatePath("/crm/leads");
    revalidatePath(`/crm/leads/${id}`);
    return { message: "Lead updated" };
  });
}

export async function changeLeadStage(id: string, stage: string, lostReason?: string) {
  return run(async () => {
    const c = await assertPerm("leads:edit");
    const s = z.nativeEnum(LeadStage).parse(stage);
    const lead = await getLead(c, id);
    if (lead.stage === s) return { message: "No change" };
    if (s === "LOST" && !lostReason?.trim()) throw new UserError("Please give a reason for losing this lead.");
    await db.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: { stage: s, lostReason: s === "LOST" ? lostReason!.trim() : null } });
      await tx.leadActivity.create({
        data: { companyId: c.companyId, leadId: id, kind: "STAGE_CHANGE", userId: c.userId, body: `Stage: ${humanize(lead.stage)} → ${humanize(s)}${s === "LOST" ? ` (${lostReason})` : ""}` },
      });
      await audit(c, { action: "UPDATE", entityType: "Lead", entityId: id, summary: `Moved lead ${lead.code} from ${humanize(lead.stage)} to ${humanize(s)}`, oldValue: { stage: lead.stage }, newValue: { stage: s } }, tx);
    });
    revalidatePath("/crm/leads");
    revalidatePath(`/crm/leads/${id}`);
    return { message: `Moved to ${humanize(s)}` };
  });
}

const activitySchema = z.object({
  kind: z.enum(["NOTE", "CALL", "WHATSAPP", "EMAIL"]),
  body: zReqStr("Write something first"),
});

export async function addLeadActivity(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("leads:edit");
    const d = activitySchema.parse(formToObject(fd));
    const lead = await getLead(c, id);
    await db.leadActivity.create({ data: { companyId: c.companyId, leadId: id, kind: d.kind, body: d.body, userId: c.userId } });
    // first real contact moves a NEW lead to CONTACTED
    if (lead.stage === "NEW" && d.kind !== "NOTE") await db.lead.update({ where: { id }, data: { stage: "CONTACTED" } });
    revalidatePath(`/crm/leads/${id}`);
    return { message: "Logged" };
  });
}

const followUpSchema = z.object({ nextFollowUp: zDate("Pick a follow-up date"), note: zOptStr });

export async function setFollowUp(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("leads:edit");
    const d = followUpSchema.parse(formToObject(fd));
    const lead = await getLead(c, id);
    await db.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: { nextFollowUp: d.nextFollowUp } });
      await tx.leadActivity.create({
        data: { companyId: c.companyId, leadId: id, kind: "FOLLOW_UP", userId: c.userId, body: `Follow-up set for ${d.nextFollowUp.toLocaleDateString("en-IN")}${d.note ? ` – ${d.note}` : ""}` },
      });
      await audit(c, { action: "UPDATE", entityType: "Lead", entityId: id, summary: `Follow-up for ${lead.code} set to ${d.nextFollowUp.toISOString().slice(0, 10)}` }, tx);
    });
    revalidatePath("/crm/follow-ups");
    revalidatePath(`/crm/leads/${id}`);
    return { message: "Follow-up scheduled" };
  });
}

export async function completeFollowUp(id: string, fd?: FormData) {
  return run(async () => {
    const c = await assertPerm("leads:edit");
    const lead = await getLead(c, id);
    const note = fd ? String(fd.get("note") ?? "").trim() : "";
    const next = fd ? String(fd.get("nextFollowUp") ?? "").trim() : "";
    await db.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: { nextFollowUp: next ? new Date(next) : null, stage: lead.stage === "NEW" ? "CONTACTED" : lead.stage } });
      await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: id, kind: "FOLLOW_UP", userId: c.userId, body: `Follow-up done${note ? `: ${note}` : ""}${next ? `. Next on ${new Date(next).toLocaleDateString("en-IN")}` : ""}` } });
    });
    revalidatePath("/crm/follow-ups");
    revalidatePath(`/crm/leads/${id}`);
    return { message: "Follow-up completed" };
  });
}

export async function deleteLead(id: string) {
  return run(async () => {
    const c = await assertPerm("leads:delete");
    const lead = await getLead(c, id);
    const quotes = await db.quotation.count({ where: { leadId: id, deletedAt: null } });
    if (quotes > 0) throw new UserError("This lead has quotations, so it can't be deleted. Mark it Lost instead.");
    await db.lead.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(c, { action: "DELETE", entityType: "Lead", entityId: id, summary: `Deleted lead ${lead.code} – ${lead.name}` });
    revalidatePath("/crm/leads");
    return { message: "Lead deleted" };
  });
}

/** Lead → Client: copies all details forward and links the two. Safe to call twice. */
export async function convertLeadToClient(id: string) {
  return run(async () => {
    const c = await assertPerm("clients:create");
    const lead = await getLead(c, id);
    if (lead.clientId) return { message: "Already a client", data: { clientId: lead.clientId } };
    const client = await db.$transaction(async (tx) => {
      const code = await nextNumber(tx, c.companyId, "CL");
      const cl = await tx.client.create({
        data: {
          companyId: c.companyId, code, name: lead.name, companyName: lead.companyName, phone: lead.phone ?? lead.whatsapp,
          email: lead.email, address: lead.location, notes: lead.requirement,
        },
      });
      await tx.lead.update({ where: { id }, data: { clientId: cl.id } });
      await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: id, kind: "NOTE", userId: c.userId, body: `Converted to client ${code}` } });
      await audit(c, { action: "CREATE", entityType: "Client", entityId: cl.id, summary: `Converted lead ${lead.code} to client ${code}` }, tx);
      return cl;
    });
    revalidatePath(`/crm/leads/${id}`);
    revalidatePath("/crm/clients");
    return { message: `Client ${client.code} created`, data: { clientId: client.id } };
  });
}

// ───────────── CLIENTS ─────────────
const clientSchema = z.object({
  name: zReqStr("Name is required"),
  companyName: zOptStr,
  phone: zPhone,
  email: zEmail,
  address: zOptStr,
  billingAddress: zOptStr,
  gstin: zGstin,
  pan: zPan,
  projectManagerId: zOptStr,
  notes: zOptStr,
});

export async function createClient(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("clients:create");
    const d = clientSchema.parse(formToObject(fd));
    const cl = await db.$transaction(async (tx) => {
      const code = await nextNumber(tx, c.companyId, "CL");
      const x = await tx.client.create({ data: { ...d, companyId: c.companyId, code, projectManagerId: d.projectManagerId ?? null } });
      await audit(c, { action: "CREATE", entityType: "Client", entityId: x.id, summary: `Created client ${code} – ${d.name}`, newValue: d }, tx);
      return x;
    });
    revalidatePath("/crm/clients");
    return { message: `Client ${cl.code} created`, data: { id: cl.id } };
  });
}

export async function updateClient(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("clients:edit");
    const d = clientSchema.parse(formToObject(fd));
    const old = await db.client.findFirst({ where: { id, ...clientScope(c) } });
    if (!old) throw new UserError("Client not found.");
    await db.client.update({ where: { id }, data: { ...d, projectManagerId: d.projectManagerId ?? null } });
    await audit(c, { action: "UPDATE", entityType: "Client", entityId: id, summary: `Updated client ${old.code} – ${old.name}`, oldValue: { name: old.name, phone: old.phone, email: old.email, gstin: old.gstin }, newValue: d });
    revalidatePath("/crm/clients");
    revalidatePath(`/crm/clients/${id}`);
    return { message: "Client updated" };
  });
}

export async function deleteClient(id: string) {
  return run(async () => {
    const c = await assertPerm("clients:delete");
    const cl = await db.client.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!cl) throw new UserError("Client not found.");
    const [projects, invoices, quotes] = await Promise.all([
      db.project.count({ where: { clientId: id, deletedAt: null } }),
      db.invoice.count({ where: { clientId: id, deletedAt: null } }),
      db.quotation.count({ where: { clientId: id, deletedAt: null } }),
    ]);
    if (projects + invoices + quotes > 0) throw new UserError("This client has projects, quotations or invoices, so it can't be deleted.");
    await db.client.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(c, { action: "DELETE", entityType: "Client", entityId: id, summary: `Deleted client ${cl.code} – ${cl.name}` });
    revalidatePath("/crm/clients");
    return { message: "Client deleted" };
  });
}

// ───────────── SITE VISITS ─────────────
const visitSchema = z.object({
  leadId: zOptStr,
  clientId: zOptStr,
  siteAddress: zReqStr("Site address is required"),
  visitDate: zDate("Pick a visit date"),
  visitTime: zOptStr,
  assignedToId: zOptStr,
  siteCondition: zOptStr,
  measurements: zOptStr,
  requirements: zOptStr,
  estimatedArea: zOptNum,
  notes: zOptStr,
  followUpDate: zOptDate,
});

export async function createSiteVisit(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("sitevisits:create");
    const d = visitSchema.parse(formToObject(fd));
    if (!d.leadId && !d.clientId) throw new UserError("Select a lead or a client for this visit.");
    if (d.leadId) await getLead(c, d.leadId);
    const v = await db.$transaction(async (tx) => {
      const x = await tx.siteVisit.create({ data: { ...d, companyId: c.companyId, leadId: d.leadId ?? null, clientId: d.clientId ?? null, assignedToId: d.assignedToId ?? c.userId } });
      if (d.leadId) {
        const l = await tx.lead.findUnique({ where: { id: d.leadId } });
        const early: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED"];
        if (l && early.includes(l.stage)) await tx.lead.update({ where: { id: l.id }, data: { stage: "SITE_VISIT_SCHEDULED" } });
        await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: d.leadId, kind: "NOTE", userId: c.userId, body: `Site visit scheduled for ${d.visitDate.toLocaleDateString("en-IN")}${d.visitTime ? ` at ${d.visitTime}` : ""}` } });
      }
      const who = x.assignedToId;
      if (who && who !== c.userId) await notifyUsers([who], { companyId: c.companyId, type: "GENERAL", title: "Site visit assigned to you", body: d.siteAddress, link: "/crm/site-visits" }, tx);
      await audit(c, { action: "CREATE", entityType: "SiteVisit", entityId: x.id, summary: `Scheduled site visit at ${d.siteAddress}`, newValue: d }, tx);
      return x;
    });
    revalidatePath("/crm/site-visits");
    return { message: "Site visit scheduled", data: { id: v.id } };
  });
}

export async function updateSiteVisit(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("sitevisits:edit");
    const d = visitSchema.parse(formToObject(fd));
    const old = await db.siteVisit.findFirst({ where: { id, companyId: c.companyId } });
    if (!old) throw new UserError("Site visit not found.");
    await db.siteVisit.update({ where: { id }, data: { ...d, leadId: d.leadId ?? null, clientId: d.clientId ?? null, assignedToId: d.assignedToId ?? null } });
    await audit(c, { action: "UPDATE", entityType: "SiteVisit", entityId: id, summary: `Updated site visit at ${d.siteAddress}`, newValue: d });
    revalidatePath("/crm/site-visits");
    return { message: "Site visit updated" };
  });
}

export async function completeSiteVisit(id: string) {
  return run(async () => {
    const c = await assertPerm("sitevisits:edit");
    const v = await db.siteVisit.findFirst({ where: { id, companyId: c.companyId } });
    if (!v) throw new UserError("Site visit not found.");
    await db.$transaction(async (tx) => {
      await tx.siteVisit.update({ where: { id }, data: { completed: true } });
      if (v.leadId) {
        const l = await tx.lead.findUnique({ where: { id: v.leadId } });
        const before: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT_SCHEDULED"];
        if (l && before.includes(l.stage)) await tx.lead.update({ where: { id: l.id }, data: { stage: "SITE_VISIT_COMPLETED" } });
        await tx.leadActivity.create({ data: { companyId: c.companyId, leadId: v.leadId, kind: "NOTE", userId: c.userId, body: "Site visit completed" } });
        if (v.followUpDate) await tx.lead.update({ where: { id: v.leadId }, data: { nextFollowUp: v.followUpDate } });
      }
      await audit(c, { action: "UPDATE", entityType: "SiteVisit", entityId: id, summary: `Completed site visit at ${v.siteAddress}` }, tx);
    });
    revalidatePath("/crm/site-visits");
    return { message: "Site visit marked complete" };
  });
}

export async function deleteSiteVisit(id: string) {
  return run(async () => {
    const c = await assertPerm("sitevisits:edit");
    const v = await db.siteVisit.findFirst({ where: { id, companyId: c.companyId } });
    if (!v) throw new UserError("Site visit not found.");
    await db.siteVisit.delete({ where: { id } });
    await audit(c, { action: "DELETE", entityType: "SiteVisit", entityId: id, summary: `Deleted site visit at ${v.siteAddress}` });
    revalidatePath("/crm/site-visits");
    return { message: "Site visit deleted" };
  });
}
