import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime, cn } from "@/lib/utils";
import { ActionButton } from "@/components/forms/action-button";
import { markAllRead } from "@/app/(app)/notifications/actions";

export const metadata = { title: "Alerts" };

export default async function WorkerAlerts() {
  const c = await requireCtx();
  if (c.role !== "WORKER") redirect("/");
  const rows = await db.notification.findMany({ where: { userId: c.userId }, orderBy: { createdAt: "desc" }, take: 30 });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold text-slate-900">Alerts</h1><Link href="/worker" className="text-sm font-medium text-brand-700">← Back</Link></div>
      {rows.some((r) => !r.readAt) && <ActionButton variant="secondary" action={markAllRead}>Mark all as read</ActionButton>}
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">No alerts.</p> : (
        <ul className="space-y-2">{rows.map((n) => <li key={n.id} className={cn("rounded-2xl border bg-white p-4", n.readAt ? "border-slate-200" : "border-brand-300 ring-1 ring-brand-200")}><p className="font-semibold text-slate-900">{n.title}</p>{n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}<p className="mt-1 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p></li>)}</ul>
      )}
    </div>
  );
}
