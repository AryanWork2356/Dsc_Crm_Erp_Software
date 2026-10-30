"use server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { run, UserError } from "@/lib/action";
import { pushKeys, sendPush } from "@/lib/push";

async function me() {
  const c = await getCtx();
  if (!c) throw new UserError("Please sign in again.");
  return c;
}

/** The public half of the app's alert key, which the phone needs to subscribe. */
export async function pushPublicKey() {
  return run(async () => {
    await me();
    return { message: "ok", data: { key: (await pushKeys()).publicKey } };
  });
}

const subSchema = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(4).max(100) }) });

/** This phone said yes to alerts: keep its address for this person (moving it if someone else used the phone before). */
export async function savePushSubscription(json: string, userAgent?: string) {
  return run(async () => {
    const c = await me();
    let v: unknown;
    try { v = JSON.parse(json); } catch { throw new UserError("The phone's answer could not be read."); }
    const s = subSchema.parse(v);
    await db.pushSubscription.upsert({
      where: { endpoint: s.endpoint },
      create: { companyId: c.companyId, userId: c.userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null },
      update: { companyId: c.companyId, userId: c.userId, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null },
    });
    const sent = await sendPush([c.userId], { title: "Phone alerts are on", body: "You will get the day's work, reminders and problems here.", url: "/today" });
    return { message: sent ? "Phone alerts are on. A test alert was sent." : "Phone alerts are on." };
  });
}

export async function removePushSubscription(endpoint: string) {
  return run(async () => {
    const c = await me();
    await db.pushSubscription.deleteMany({ where: { endpoint, userId: c.userId } });
    return { message: "Phone alerts are off on this phone" };
  });
}
