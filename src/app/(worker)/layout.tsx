import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, HardHat, LogOut } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { logout } from "../login/actions";

/** Worker app shell: one column, big touch targets, almost no text. */
export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const c = await requireCtx();
  if (c.role !== "WORKER") redirect("/");
  const unread = await db.notification.count({ where: { userId: c.userId, readAt: null } });
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-slate-50">
      <header className="flex items-center gap-3 bg-brand-900 px-4 py-4 text-white">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent"><HardHat className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1 leading-tight"><p className="truncate text-base font-semibold">{c.name}</p><p className="text-xs text-white/70">DSC Interior – Site app</p></div>
        <Link href="/worker/alerts" className="relative rounded-lg p-2.5 hover:bg-white/10" aria-label="Alerts"><Bell className="h-6 w-6" />{unread > 0 && <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold">{unread}</span>}</Link>
        <form action={logout}><button className="rounded-lg p-2.5 hover:bg-white/10" aria-label="Sign out"><LogOut className="h-6 w-6" /></button></form>
      </header>
      <main className="flex-1 px-4 py-5">{children}</main>
    </div>
  );
}
