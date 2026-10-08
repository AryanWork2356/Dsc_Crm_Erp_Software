import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/forms/action-button";
import { formatDateTime, humanize, cn } from "@/lib/utils";
import { markAllRead, markRead } from "./actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("notifications:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 25);
  const where = { userId: c.userId, ...(sp.show === "unread" ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId: c.userId, readAt: null } }),
  ]);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up."}
        actions={
          <>
            <Link href={sp.show === "unread" ? "/notifications" : "/notifications?show=unread"} className="text-sm font-medium text-brand-700 hover:underline">
              {sp.show === "unread" ? "Show all" : "Show unread only"}
            </Link>
            {unread > 0 && <ActionButton variant="secondary" size="sm" action={markAllRead}>Mark all read</ActionButton>}
          </>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No notifications" hint="Approvals, follow-ups, deliveries and payment alerts will show up here." />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {rows.map((n) => (
                <li key={n.id} className={cn("flex items-start gap-3 px-5 py-4", !n.readAt && "bg-brand-50/50")}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">{n.title}</p>
                      <Badge>{humanize(n.type)}</Badge>
                    </div>
                    {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                    <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {n.link && (
                      <Link href={n.link} className="text-sm font-medium text-brand-700 hover:underline">Open</Link>
                    )}
                    {!n.readAt && <ActionButton size="sm" variant="ghost" action={markRead.bind(null, n.id)}>Mark read</ActionButton>}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/notifications" />
          </>
        )}
      </Card>
    </>
  );
}
