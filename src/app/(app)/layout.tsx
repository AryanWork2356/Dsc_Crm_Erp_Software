import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { menuFor } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/permissions";
import { homeFor } from "@/lib/home";
import { Sidebar, type SidebarGroup } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { logout } from "../login/actions";
import { aiActive, canControlAi } from "@/lib/ai";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const c = await requireCtx();
  // Workers / clients / vendors use their own simplified experiences.
  if (c.role === "WORKER" || c.role === "CLIENT" || c.role === "VENDOR") redirect(homeFor(c.role));
  if (c.mustChangePassword) redirect("/change-password");

  const [company, unread] = await Promise.all([
    db.companySettings.findUnique({ where: { companyId: c.companyId }, include: { company: true } }),
    db.notification.count({ where: { userId: c.userId, readAt: null } }),
  ]);

  // "Ask the app" appears only once the AI helper is switched on (an AI key is set)
  const ai = await aiActive(c.companyId);
  const groups: SidebarGroup[] = menuFor(c.role, c.can).map((g) => ({ ...g, items: g.items.filter((i) => (i.href !== "/ask" || ai) && (i.href !== "/settings/ai" || canControlAi(c))) }));

  return (
    <div className="flex h-screen overflow-hidden">
      {ai && <span id="ai-on" hidden />}{/* tells the notes boxes to show the ✨ spelling button */}
      <Sidebar groups={groups} companyName={company?.legalName ?? company?.company.name ?? "DSC Interior"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={c.name} roleLabel={ROLE_LABELS[c.role]} unread={unread} logout={logout} />
        <main className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
