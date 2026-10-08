import "server-only";
import { db } from "./db";
import { decryptSecret } from "./crypto";

/**
 * WhatsApp Business — official Cloud API only (no unofficial automation).
 *
 * Provider abstraction: if credentials are saved in Settings → WhatsApp the app really sends through Meta's
 * Cloud API; otherwise messages are stored as "FAILED – not connected" so nothing is silently lost.
 * Free-form text can only be sent inside WhatsApp's 24-hour customer-service window; outside it Meta requires
 * pre-approved templates (see docs). The template catalogue below holds the wording DSC uses.
 */

export type WaConfig = { enabled: boolean; phoneNumberId: string; accessToken: string; verifyToken: string; appSecret: string; autoMessages: boolean };

export function readWaConfig(json: unknown): WaConfig {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof j[k] === "string" ? (j[k] as string) : "");
  return { enabled: j.enabled === true, phoneNumberId: s("phoneNumberId"), accessToken: decryptSecret(s("accessToken")), verifyToken: s("verifyToken"), appSecret: decryptSecret(s("appSecret")), autoMessages: j.autoMessages === true };
}

export const isConnected = (c: WaConfig) => c.enabled && !!c.phoneNumberId && !!c.accessToken;

export const TEMPLATES: Record<string, { label: string; body: string }> = {
  lead_ack: { label: "Lead acknowledgement", body: "Hi {{name}}, thank you for contacting {{company}}! We've received your enquiry and our team will call you shortly." },
  site_visit: { label: "Site visit confirmation", body: "Hi {{name}}, your site visit with {{company}} is confirmed for {{date}}. Please keep the site accessible. Reply here if you need to reschedule." },
  quotation_sent: { label: "Quotation sent", body: "Hi {{name}}, we've sent you quotation {{number}} for ₹{{amount}}. Please review it and let us know if you have any questions." },
  quotation_followup: { label: "Quotation follow-up", body: "Hi {{name}}, just checking in on quotation {{number}}. Happy to walk you through it or adjust the scope – when is a good time to talk?" },
  payment_reminder: { label: "Payment reminder", body: "Hi {{name}}, a gentle reminder that invoice {{number}} of ₹{{amount}} was due on {{date}}. Kindly arrange payment. Thank you – {{company}}" },
  project_update: { label: "Project update", body: "Hi {{name}}, a quick update on your project: {{update}}. – {{company}}" },
  material_delivery: { label: "Material delivery update", body: "Hi {{name}}, material for your project is scheduled to reach site on {{date}}. – {{company}}" },
  handover: { label: "Handover message", body: "Hi {{name}}, your project is complete and ready for handover! Thank you for trusting {{company}}. Your warranty starts today." },
  warranty_update: { label: "Warranty / support update", body: "Hi {{name}}, an update on your request {{number}}: {{update}}. – {{company}}" },
};

export function renderTemplate(key: string, vars: Record<string, string | number | undefined>): string {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`Unknown template ${key}`);
  return t.body.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? "").trim() || `{{${k}}}`);
}

/** Digits only, with India's +91 added to 10-digit numbers. */
export function normalizePhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return d;
}
export const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);

export type SendResult = { ok: boolean; externalId?: string; error?: string };

export async function sendText(cfg: WaConfig, to: string, body: string): Promise<SendResult> {
  if (!isConnected(cfg)) return { ok: false, error: "WhatsApp is not connected yet. Add the Cloud API details in Settings → WhatsApp." };
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: false } }),
      signal: AbortSignal.timeout(15000),
    });
    const j = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: j.error?.message ?? `WhatsApp rejected the message (${res.status})` };
    return { ok: true, externalId: j.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach WhatsApp" };
  }
}

export async function loadWaConfig(companyId: string) {
  const s = await db.companySettings.findUnique({ where: { companyId } });
  return readWaConfig(s?.whatsappConfig);
}

/** Find or create the conversation for a phone number, linking it to a lead/client by number. */
export async function ensureConversation(companyId: string, phoneRaw: string, name?: string, link?: { leadId?: string; clientId?: string }) {
  const phone = normalizePhone(phoneRaw);
  const existing = await db.whatsAppConversation.findUnique({ where: { companyId_phone: { companyId, phone } } });
  if (existing) return existing;
  const tail = last10(phone);
  const [lead, client] = await Promise.all([
    link?.leadId ? null : db.lead.findFirst({ where: { companyId, deletedAt: null, OR: [{ phone: { endsWith: tail } }, { whatsapp: { endsWith: tail } }] }, orderBy: { createdAt: "desc" } }),
    link?.clientId ? null : db.client.findFirst({ where: { companyId, deletedAt: null, phone: { endsWith: tail } } }),
  ]);
  return db.whatsAppConversation.create({
    data: { companyId, phone, contactName: name || client?.name || lead?.name || `+${phone}`, leadId: link?.leadId ?? lead?.id ?? null, clientId: link?.clientId ?? client?.id ?? null, assignedToId: lead?.assignedToId ?? null },
  });
}

/** Record + send an outbound message. Never throws: failures are stored on the message. */
export async function deliver(companyId: string, conversationId: string, body: string, sentById: string | null, template?: string) {
  const conv = await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const cfg = await loadWaConfig(companyId);
  const msg = await db.whatsAppMessage.create({ data: { conversationId, direction: "OUTBOUND", body, template, status: "QUEUED", sentById } });
  const r = await sendText(cfg, conv.phone, body);
  await db.$transaction([
    db.whatsAppMessage.update({ where: { id: msg.id }, data: { status: r.ok ? "SENT" : "FAILED", externalId: r.externalId ?? null } }),
    db.whatsAppConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }),
  ]);
  return { ok: r.ok, error: r.error, messageId: msg.id };
}

/** Automatic business messages (lead acknowledgement, payment reminder…) – only when connected AND auto-messages are on. */
export async function autoMessage(companyId: string, phone: string | null | undefined, templateKey: string, vars: Record<string, string | number | undefined>, link?: { leadId?: string; clientId?: string }) {
  if (!phone) return;
  const cfg = await loadWaConfig(companyId);
  if (!isConnected(cfg) || !cfg.autoMessages) return;
  const company = await db.companySettings.findUnique({ where: { companyId }, include: { company: true } });
  const conv = await ensureConversation(companyId, phone, String(vars.name ?? ""), link);
  await deliver(companyId, conv.id, renderTemplate(templateKey, { company: company?.legalName ?? company?.company.name, ...vars }), null, templateKey);
}
