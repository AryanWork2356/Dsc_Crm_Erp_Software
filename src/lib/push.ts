import "server-only";
import webpush from "web-push";
import { db } from "./db";

/**
 * Phone alerts (Web Push). The app makes its own key pair once and keeps it in the database, so nothing has to be set up on the host.
 * Every in-app notification is also sent to the phones and computers of that person that said yes to alerts.
 * iPhone: works only when the app is installed on the home screen (iOS 16.4 or later). Sending never breaks the action that caused it.
 */
type Keys = { publicKey: string; privateKey: string };
let cached: Keys | null = null;

export async function pushKeys(): Promise<Keys> {
  if (cached) return cached;
  const row = await db.appSecret.findUnique({ where: { key: "vapid" } });
  if (row) return (cached = JSON.parse(row.value) as Keys);
  const k = webpush.generateVAPIDKeys();
  try {
    await db.appSecret.create({ data: { key: "vapid", value: JSON.stringify(k) } });
    return (cached = k);
  } catch {
    // another request made them at the same moment: use those
    const again = await db.appSecret.findUniqueOrThrow({ where: { key: "vapid" } });
    return (cached = JSON.parse(again.value) as Keys);
  }
}

export type PushMessage = { title: string; body?: string; url?: string; tag?: string };

export async function sendPush(userIds: string[], m: PushMessage): Promise<number> {
  if (!userIds.length) return 0;
  const subs = await db.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  if (!subs.length) return 0;
  const k = await pushKeys();
  const contact = process.env.PUSH_CONTACT ?? `mailto:admin@${(process.env.APP_URL ?? "https://app.dscinterior.co.in").replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
  const payload = JSON.stringify({ title: m.title.slice(0, 120), body: (m.body ?? "").slice(0, 300), url: m.url ?? "/notifications", tag: m.tag });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { vapidDetails: { subject: contact, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 60 * 60 * 12, timeout: 8000 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.pushSubscription.deleteMany({ where: { id: s.id } }); // the phone said no, or the app was removed
      else console.error("push failed", code ?? e);
    }
  }));
  return sent;
}
