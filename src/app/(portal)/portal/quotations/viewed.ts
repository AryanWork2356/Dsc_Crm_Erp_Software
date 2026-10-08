import "server-only";
import { db } from "@/lib/db";

/** Opening a sent quotation in the portal marks it "Viewed" so sales can see the client has read it. */
export async function markViewed(ids: string[], companyId: string) {
  if (!ids.length) return;
  await db.quotation.updateMany({ where: { id: { in: ids }, companyId, status: "SENT" }, data: { status: "VIEWED" } });
}
