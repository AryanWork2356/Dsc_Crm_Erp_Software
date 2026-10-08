import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ensureConversation, readWaConfig } from "@/lib/whatsapp";
import { notifyUsers, notifyRoles } from "@/lib/notify";

/**
 * Meta WhatsApp Cloud API webhook.
 *  GET  – one-time verification handshake (matches the verify token saved in Settings → WhatsApp)
 *  POST – inbound messages + delivery status updates. Every request is authenticated by Meta's HMAC
 *         signature (X-Hub-Signature-256) using the app secret; unsigned/forged requests are rejected.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const token = q.get("hub.verify_token");
  if (q.get("hub.mode") !== "subscribe" || !token) return new Response("Bad request", { status: 400 });
  const match = await db.companySettings.findFirst({ where: { whatsappConfig: { path: ["verifyToken"], equals: token } }, select: { id: true } });
  if (!match) return new Response("Forbidden", { status: 403 });
  return new Response(q.get("hub.challenge") ?? "", { status: 200 });
}

type Change = { value?: { metadata?: { phone_number_id?: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: { id: string; from: string; type: string; text?: { body?: string }; image?: unknown; document?: unknown; audio?: unknown }[]; statuses?: { id: string; status: string }[] } };

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let payload: { entry?: { changes?: Change[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  let handled = 0;

  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value;
      const pnid = v?.metadata?.phone_number_id;
      if (!v || !pnid) continue;
      const settings = await db.companySettings.findFirst({ where: { whatsappConfig: { path: ["phoneNumberId"], equals: pnid } } });
      if (!settings) continue;
      const cfg = readWaConfig(settings.whatsappConfig);
      if (!cfg.enabled || !cfg.appSecret) return new Response("Not configured", { status: 401 });
      const expected = "sha256=" + crypto.createHmac("sha256", cfg.appSecret).update(raw).digest("hex");
      const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      if (!ok) return new Response("Invalid signature", { status: 401 });
      const companyId = settings.companyId;

      for (const m of v.messages ?? []) {
        if (await db.whatsAppMessage.findFirst({ where: { externalId: m.id } })) continue; // Meta retries – stay idempotent
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        const conv = await ensureConversation(companyId, m.from, name);
        const body = m.type === "text" ? m.text?.body ?? "" : `[${m.type} received – open WhatsApp on your phone to view it]`;
        await db.$transaction([
          db.whatsAppMessage.create({ data: { conversationId: conv.id, direction: "INBOUND", body, status: "RECEIVED", externalId: m.id } }),
          db.whatsAppConversation.update({ where: { id: conv.id }, data: { unread: { increment: 1 }, lastMessageAt: new Date() } }),
        ]);
        const text = `${conv.contactName}: ${body.slice(0, 120)}`;
        if (conv.assignedToId) await notifyUsers([conv.assignedToId], { companyId, type: "GENERAL", title: "New WhatsApp message", body: text, link: `/whatsapp?c=${conv.id}` });
        else await notifyRoles(companyId, ["SALES", "ADMIN"], { type: "GENERAL", title: "New WhatsApp message", body: text, link: `/whatsapp?c=${conv.id}`, dedupeKey: `wa:${m.id}` });
        handled++;
      }
      for (const s of v.statuses ?? []) {
        const map: Record<string, string> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };
        if (map[s.status]) await db.whatsAppMessage.updateMany({ where: { externalId: s.id }, data: { status: map[s.status] } });
      }
    }
  }
  return Response.json({ ok: true, handled });
}
