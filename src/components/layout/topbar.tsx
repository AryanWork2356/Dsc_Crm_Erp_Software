"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Search } from "lucide-react";
import { initials } from "@/lib/utils";

export function Topbar({
  name,
  roleLabel,
  unread,
  logout,
}: {
  name: string;
  roleLabel: string;
  unread: number;
  logout: () => Promise<void>;
}) {
  const router = useRouter();
  const [q, setQ] = React.useState("");

  return (
    <header className="no-print flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white pl-14 pr-4 lg:px-6">
      <form
        className="relative max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
        role="search"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients, leads, projects, POs, invoices…"
          className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
          aria-label="Global search"
        />
      </form>
      <div className="ml-auto flex items-center gap-3">
        <Link href="/notifications" className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>
        <div className="hidden text-right leading-tight sm:block">
          <p className="text-sm font-medium text-slate-900">{name}</p>
          <p className="text-xs text-slate-500">{roleLabel}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">{initials(name)}</div>
        <form action={logout}>
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Sign out" title="Sign out">
            <LogOut className="h-5 w-5" />
          </button>
        </form>
      </div>
    </header>
  );
}
