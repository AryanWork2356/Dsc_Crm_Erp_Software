"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { run } from "@/lib/action";

export async function markRead(id: string) {
  return run(async () => {
    const c = await assertPerm("notifications:view");
    await db.notification.updateMany({ where: { id, userId: c.userId, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/notifications");
    return { message: "Marked as read" };
  });
}

export async function markAllRead() {
  return run(async () => {
    const c = await assertPerm("notifications:view");
    await db.notification.updateMany({ where: { userId: c.userId, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/notifications");
    return { message: "All notifications marked as read" };
  });
}
