"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell, CheckSquare, ChevronDown, LayoutDashboard, Menu, Settings, Users, X, FileText, FolderKanban,
  ShoppingCart, Boxes, HardHat, Wallet, UserCog, FolderOpen, MessageCircle, LifeBuoy, BarChart3, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "layout-dashboard": LayoutDashboard, users: Users, "check-square": CheckSquare, bell: Bell, settings: Settings,
  "file-text": FileText, "folder-kanban": FolderKanban, "shopping-cart": ShoppingCart, boxes: Boxes,
  "hard-hat": HardHat, wallet: Wallet, "user-cog": UserCog, "folder-open": FolderOpen,
  "message-circle": MessageCircle, "life-buoy": LifeBuoy, "bar-chart": BarChart3,
};

export type SidebarGroup = {
  label?: string;
  icon: string;
  href?: string;
  items: { label: string; href: string }[];
};

export function Sidebar({ groups, companyName }: { groups: SidebarGroup[]; companyName: string }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => setOpen(false), [pathname]);

  const nav = (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
      {groups.map((g) => (
        <Group key={g.label} g={g} pathname={pathname} />
      ))}
    </nav>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="no-print fixed left-3 top-3 z-30 rounded-lg border border-slate-200 bg-white p-2 shadow-sm lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* desktop */}
      <aside className="no-print hidden w-64 shrink-0 flex-col bg-brand-950 text-slate-300 lg:flex">
        <Brand name={companyName} />
        {nav}
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-brand-950 text-slate-300 shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand name={companyName} />
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded p-1 text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <div className="flex h-16 items-center gap-3 px-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white">
        <Building2 className="h-5 w-5" />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        <p className="text-[11px] uppercase tracking-wider text-slate-400">ERP + CRM</p>
      </div>
    </div>
  );
}

function Group({ g, pathname }: { g: SidebarGroup; pathname: string }) {
  const Icon = ICONS[g.icon] ?? LayoutDashboard;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const childActive = g.items.some((i) => isActive(i.href));
  const [open, setOpen] = React.useState(childActive);

  const base = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors";

  if (g.href) {
    return (
      <Link href={g.href} className={cn(base, isActive(g.href) ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white")}>
        <Icon className="h-4 w-4" /> {g.label}
      </Link>
    );
  }
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className={cn(base, childActive ? "text-white" : "hover:bg-white/5 hover:text-white")} aria-expanded={open}>
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{g.label}</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-3">
          {g.items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={cn(
                "block rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive(i.href) ? "bg-white/10 font-medium text-white" : "text-slate-400 hover:text-white",
              )}
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
