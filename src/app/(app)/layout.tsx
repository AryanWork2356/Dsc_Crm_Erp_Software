import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { NAV } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/permissions";
import { homeFor } from "@/lib/home";
import { Sidebar, type SidebarGroup } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const c = await requireCtx();
  // Workers / clients / vendors use their own simplified experiences.
  if (c.role === "WORKER" || c.role === "CLIENT" || c.role === "VENDOR") redirect(homeFor(c.role));

  const [company, unread] = await Promise.all([
    db.companySettings.findUnique({ where: { companyId: c.companyId }, include: { company: true } }),
    db.notification.count({ where: { userId: c.userId, readAt: null } }),
  ]);

  const groups: SidebarGroup[] = NAV.map((g) => {
    const items = g.items.filter((i) => !i.perm || c.can(i.perm));
    return { label: g.label, icon: g.icon, href: g.href, items, perm: g.perm };
  })
    .filter((g) => (g.href ? !g.perm || c.can(g.perm) : g.items.length > 0))
    .map(({ perm: _p, ...g }) => g);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar groups={groups} companyName={company?.legalName ?? company?.company.name ?? "DSC Interior"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={c.name} roleLabel={ROLE_LABELS[c.role]} unread={unread} logout={logout} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
