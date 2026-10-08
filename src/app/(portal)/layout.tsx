import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, LogOut } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { logout } from "../login/actions";

/** Shared frame for the client and vendor portals: light, mobile-friendly, no internal menus. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const c = await requireCtx();
  if (c.role !== "CLIENT" && c.role !== "VENDOR") redirect("/");
  const [co, unread] = await Promise.all([
    db.companySettings.findUnique({ where: { companyId: c.companyId }, include: { company: true } }),
    db.notification.count({ where: { userId: c.userId, readAt: null } }),
  ]);
  const base = c.role === "CLIENT" ? "/portal" : "/vendor-portal";
  const links = c.role === "CLIENT"
    ? [["Overview", "/portal"], ["Quotations", "/portal/quotations"], ["Invoices", "/portal/invoices"], ["Support", "/portal/support"]]
    : [["Orders", "/vendor-portal"], ["Payments", "/vendor-portal/payments"]];
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href={base} className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white"><Building2 className="h-5 w-5" /></span>
            <span className="leading-tight"><span className="block text-sm font-semibold text-slate-900">{co?.legalName ?? co?.company.name}</span><span className="block text-[11px] uppercase tracking-wider text-slate-500">{c.role === "CLIENT" ? "Client portal" : "Vendor portal"}</span></span>
          </Link>
          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto" aria-label="Portal">
            {links.map(([label, href]) => <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">{label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {unread > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white" title="Unread updates">{unread}</span>}
            <span className="hidden text-slate-600 sm:inline">{c.name}</span>
            <form action={logout}><button className="inline-flex items-center gap-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Sign out"><LogOut className="h-4 w-4" /></button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
