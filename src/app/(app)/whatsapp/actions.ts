"use server";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { encryptSecret } from "@/lib/crypto";
import { deliver, ensureConversation, normalizePhone, readWaConfig, renderTemplate, TEMPLATES } from "@/lib/whatsapp";
import { formToObject, zOptStr, zReqStr } from "@/lib/form";

async function conv(companyId: string, id: string) {
  const c = await db.whatsAppConversation.findFirst({ where: { id, companyId } });
  if (!c) throw new UserError("Conversation not found.");
  return c;
}

export async function startConversation(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("whatsapp:create");
    const d = z.object({ phone: zReqStr("Enter the phone number"), name: zOptStr, leadId: zOptStr, clientId: zOptStr }).parse(formToObject(fd));
    const p = normalizePhone(d.phone);
    if (p.length < 11 || p.length > 15) throw new UserError("Enter a valid phone number with country code (10-digit Indian numbers are fine).");
    const x = await ensureConversation(c.companyId, d.phone, d.name, { leadId: d.leadId, clientId: d.clientId });
    revalidatePath("/whatsapp");
    return { message: "Conversation ready", data: { id: x.id } };
  });
}

export async function sendMessage(conversationId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("whatsapp:create");
    const body = z.string().trim().min(1, "Type a message first").max(4000).parse(String(fd.get("body") ?? ""));
    const isNote = fd.get("note") === "on";
    const cv = await conv(c.companyId, conversationId);
    if (isNote) {
      await db.whatsAppMessage.create({ data: { conversationId, direction: "NOTE", body, status: "NOTE", sentById: c.userId } });
      revalidatePath("/whatsapp");
      return { message: "Internal note saved" };
    }
    const r = await deliver(c.companyId, cv.id, body, c.userId);
    await audit(c, { action: "CREATE", entityType: "WhatsAppMessage", entityId: r.messageId, summary: `WhatsApp to ${cv.contactName}: ${r.ok ? "sent" : "NOT sent (" + r.error + ")"}` });
    revalidatePath("/whatsapp");
    if (!r.ok) throw new UserError(r.error ?? "Message could not be sent.");
    return { message: "Sent" };
  });
}

export async function sendTemplate(conversationId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("whatsapp:create");
    const key = String(fd.get("template") ?? "");
    if (!TEMPLATES[key]) throw new UserError("Choose a template.");
    const cv = await conv(c.companyId, conversationId);
    const settings = await db.companySettings.findUnique({ where: { companyId: c.companyId }, include: { company: true } });
    const body = renderTemplate(key, { name: cv.contactName.split(" ")[0], company: settings?.legalName ?? settings?.company.name, number: String(fd.get("number") ?? ""), amount: String(fd.get("amount") ?? ""), date: String(fd.get("date") ?? ""), update: String(fd.get("update") ?? "") });
    if (/\{\{\w+\}\}/.test(body)) throw new UserError("Fill in the highlighted details for this template.");
    const r = await deliver(c.companyId, cv.id, body, c.userId, key);
    revalidatePath("/whatsapp");
    if (!r.ok) throw new UserError(r.error ?? "Message could not be sent.");
    return { message: "Template sent" };
  });
}

export async function assignConversation(id: string, userId: string | null) {
  return run(async () => {
    const c = await assertPerm("whatsapp:edit");
    await conv(c.companyId, id);
    if (userId && !(await db.user.findFirst({ where: { id: userId, companyId: c.companyId, isActive: true } }))) throw new UserError("User not found.");
    await db.whatsAppConversation.update({ where: { id }, data: { assignedToId: userId } });
    revalidatePath("/whatsapp");
    return { message: userId ? "Assigned" : "Unassigned" };
  });
}

export async function markConversationRead(id: string) {
  return run(async () => {
    const c = await assertPerm("whatsapp:view");
    await conv(c.companyId, id);
    await db.whatsAppConversation.update({ where: { id }, data: { unread: 0 } });
    revalidatePath("/whatsapp");
  });
}

export async function linkConversation(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("whatsapp:edit");
    await conv(c.companyId, id);
    const leadId = String(fd.get("leadId") ?? "") || null;
    const clientId = String(fd.get("clientId") ?? "") || null;
    if (leadId && !(await db.lead.findFirst({ where: { id: leadId, companyId: c.companyId } }))) throw new UserError("Lead not found.");
    if (clientId && !(await db.client.findFirst({ where: { id: clientId, companyId: c.companyId } }))) throw new UserError("Client not found.");
    await db.whatsAppConversation.update({ where: { id }, data: { leadId, clientId } });
    revalidatePath("/whatsapp");
    return { message: "Linked" };
  });
}

const cfgSchema = z.object({
  enabled: z.boolean().default(false), autoMessages: z.boolean().default(false),
  phoneNumberId: z.string().trim().regex(/^\d*$/, "The phone number ID is digits only").default(""),
  accessToken: z.string().trim().optional(), appSecret: z.string().trim().optional(), verifyToken: z.string().trim().optional(),
});

export async function saveWhatsAppConfig(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("settings:manage");
    const d = cfgSchema.parse(formToObject(fd));
    const s = await db.companySettings.findUnique({ where: { companyId: c.companyId } });
    const old = (s?.whatsappConfig && typeof s.whatsappConfig === "object" ? s.whatsappConfig : {}) as Record<string, unknown>;
    // blank secret fields mean "keep the existing value"
    const next = {
      enabled: d.enabled, autoMessages: d.autoMessages, phoneNumberId: d.phoneNumberId,
      accessToken: d.accessToken ? encryptSecret(d.accessToken) : (old.accessToken ?? ""),
      appSecret: d.appSecret ? encryptSecret(d.appSecret) : (old.appSecret ?? ""),
      verifyToken: d.verifyToken || (old.verifyToken as string) || crypto.randomBytes(16).toString("hex"),
    };
    if (d.enabled && !(readWaConfig(next).accessToken && next.phoneNumberId)) throw new UserError("To turn WhatsApp on, enter both the Phone Number ID and the access token.");
    await db.companySettings.upsert({ where: { companyId: c.companyId }, update: { whatsappConfig: next }, create: { companyId: c.companyId, whatsappConfig: next } });
    await audit(c, { action: "UPDATE", entityType: "CompanySettings", entityId: c.companyId, summary: `WhatsApp integration ${d.enabled ? "enabled" : "disabled"}${d.autoMessages ? " with automatic messages" : ""}` });
    revalidatePath("/settings/whatsapp");
    return { message: d.enabled ? "WhatsApp connected" : "Settings saved" };
  });
}
