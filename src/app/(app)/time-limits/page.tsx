import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten } from "@/lib/list";
import { maybeRunReminders } from "@/lib/reminders";
import { getTimeLimitItems, hoursLabel, MANAGER_AFTER, RULES, type Tracked } from "@/lib/time-limits";
import { cn, formatDateTime, humanize } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard, TabLinks } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Time limits" };
const WIDE = ["OWNER", "MANAGEMENT", "ADMIN"];

export default async function TimeLimitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("dashboard:view");
  const sp = flatten(await searchParams);
  await maybeRunReminders(c.companyId);
  const wide = WIDE.includes(c.role);
  const view = sp.view === "all" && wide ? "all" : sp.view === "mine" || !wide ? "mine" : "all";

  const [all, projects] = await Promise.all([
    getTimeLimitItems(c.companyId),
    wide ? Promise.resolve([]) : db.project.findMany({ where: projectScope(c), select: { id: true } }),
  ]);
  const myProjects = new Set(projects.map((p) => p.id));
  const canSee = (i: Tracked) => c.can(i.rule.perm) && (wide || i.ownerIds.includes(c.userId) || i.ownerRoles.includes(c.role) || i.managerIds.includes(c.userId) || (!!i.projectId && myProjects.has(i.projectId)));
  const isMine = (i: Tracked) => i.ownerIds.includes(c.userId) || (i.ownerIds.length === 0 && i.ownerRoles.includes(c.role)) || i.managerIds.includes(c.userId);
  const visible = all.filter(canSee);
  const shown = view === "mine" ? visible.filter(isMine) : visible;

  const users = await db.user.findMany({ where: { id: { in: [...new Set(shown.flatMap((i) => i.ownerIds))] } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const owner = (i: Tracked) => (i.ownerIds.length ? i.ownerIds.map((id) => nameOf.get(id) ?? "—").join(", ") : i.ownerRoles.map(humanize).join(" / ") || "Project manager");

  const overdue = shown.filter((i) => i.state === "overdue");
  const soon = shown.filter((i) => i.state === "due_soon");
  const mineOverdue = visible.filter((i) => i.state === "overdue" && isMine(i)).length;

  return (
    <div>
      <PageHeader
        title="Time limits"
        subtitle="Every step in the SOPs has a time limit. Anything waiting too long shows here, and the right person is told automatically."
        actions={c.can("settings:manage") ? <Button asChild variant="secondary" size="sm"><Link href="/settings/time-limits">Change limits</Link></Button> : undefined}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? "bad" : "good"} sub={view === "mine" ? "on your list" : "across everything you can see"} />
        <StatCard label="Due soon" value={soon.length} tone={soon.length ? "warn" : "good"} sub="75% of the time already used" />
        <StatCard label="Waiting on you, overdue" value={mineOverdue} tone={mineOverdue ? "bad" : "good"} />
      </div>
      {wide && <div className="mb-4"><TabLinks current={view} tabs={[{ key: "all", label: "Everything", href: "/time-limits?view=all", count: visible.length }, { key: "mine", label: "Waiting on me", href: "/time-limits?view=mine", count: visible.filter(isMine).length }]} /></div>}

      {shown.length === 0 ? (
        <EmptyState title="Nothing is running late" hint="When a step takes longer than its limit, it appears here and the owner is reminded." />
      ) : (
        <div className="space-y-5">
          {RULES.map((rule) => {
            const rows = shown.filter((i) => i.ruleKey === rule.key);
            if (!rows.length) return null;
            return (
              <Card key={rule.key}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>{rule.title} ({rows.length})</CardTitle>
                    <p className="mt-0.5 text-xs font-normal text-slate-500">{rule.sop}</p>
                  </div>
                  <Badge tone="slate">limit {hoursLabel(rows[0].limitHours)}</Badge>
                </CardHeader>
                <ul className="divide-y divide-slate-100">
                  {rows.map((i) => (
                    <li key={`${i.ruleKey}:${i.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <div className="min-w-0 flex-1 basis-full sm:basis-0">
                        <p className="text-sm font-medium text-slate-900 sm:truncate">{i.title}</p>
                        <p className="text-xs text-slate-500">{i.detail ? `${i.detail} · ` : ""}waiting since {formatDateTime(i.startedAt)} · with {owner(i)}</p>
                      </div>
                      {i.state === "overdue"
                        ? <Badge tone="red" className={cn(i.overdueHours >= MANAGER_AFTER(i.limitHours) && "ring-2 ring-red-300")}>{hoursLabel(Math.max(1, i.overdueHours))} late{i.overdueHours >= MANAGER_AFTER(i.limitHours) ? " · escalated" : ""}</Badge>
                        : <Badge tone="amber">due in {hoursLabel(Math.max(1, i.limitHours - i.elapsedHours))}</Badge>}
                      <Button asChild size="sm" variant="secondary"><Link href={i.link}>Open</Link></Button>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
