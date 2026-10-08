import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { maybeRunDaily } from "@/lib/automation";
import { executiveStats, PERIODS, resolvePeriod } from "@/lib/dashboard";
import { projectScope } from "@/lib/scope";
import { calendarDay, formatDate, formatINR, formatINRCompact, humanize, num, startOfDay, cn } from "@/lib/utils";
import { PageHeader, StatCard, Progress, EmptyState } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Donut, HBars, MoneyBars } from "@/components/ui/charts";

export const metadata = { title: "Dashboard" };
type SP = { period?: string; from?: string; to?: string };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const c = await requirePerm("dashboard:view");
  void maybeRunDaily(c.companyId); // once a day, first visitor triggers the reminders (never blocks or breaks the page)
  const sp = await searchParams;
  const exec = ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role);
  return exec ? <Executive c={c} sp={sp} /> : <WorkDashboard c={c} />;
}

type C = Awaited<ReturnType<typeof requirePerm>>;

/* ───────────────────────── Owner / Management ───────────────────────── */
async function Executive({ c, sp }: { c: C; sp: SP }) {
  const p = resolvePeriod(sp.period, sp.from, sp.to);
  const s = await executiveStats(c.companyId, p.from, p.to);
  const money = c.can("finance:view");
  const alerts: { tone: "bad" | "warn" | "info"; text: string; href: string }[] = [];
  if (s.pendingApprovals) alerts.push({ tone: "warn", text: `${s.pendingApprovals} item(s) awaiting approval`, href: "/approvals" });
  if (s.pendingQuotes) alerts.push({ tone: "warn", text: `${s.pendingQuotes} quotation(s) awaiting approval`, href: "/sales/quotations?status=PENDING_APPROVAL" });
  if (s.delayed) alerts.push({ tone: "bad", text: `${s.delayed} project(s) are delayed`, href: "/projects?delayed=1" });
  if (money && s.receivableOverdue > 0) alerts.push({ tone: "bad", text: `${formatINR(s.receivableOverdue)} receivables overdue (${s.receivableOverdueCount} invoice(s))`, href: "/finance/receivables" });
  if (s.lowStock) alerts.push({ tone: "warn", text: `${s.lowStock} material(s) below reorder level`, href: "/inventory/stock?low=1" });
  for (const o of s.overBudget.slice(0, 3)) alerts.push({ tone: "bad", text: `${o.code} is ${o.pct.toFixed(0)}% over budget`, href: `/projects/${o.id}?tab=financials` });
  if (s.leadsNew) alerts.push({ tone: "info", text: `${s.leadsNew} new lead(s) not yet contacted`, href: "/crm/leads?stage=NEW" });

  return (
    <>
      <PageHeader title={`Welcome, ${c.name.split(" ")[0]}`} subtitle={`Company overview – ${p.label.toLowerCase()}`} />
      <form method="get" className="mb-5 flex flex-wrap items-end gap-2" aria-label="Period">
        {PERIODS.filter((x) => x.key !== "custom").map((x) => <Link key={x.key} href={`/dashboard?period=${x.key}`} className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium", p.key === x.key ? "border-brand-800 bg-brand-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>{x.label}</Link>)}
        <span className="mx-1 hidden h-6 w-px bg-slate-300 sm:block" />
        <input type="hidden" name="period" value="custom" />
        <label className="text-xs text-slate-600">From<input type="date" name="from" defaultValue={sp.from} className="ml-1 h-9 rounded-lg border border-slate-300 px-2 text-sm" /></label>
        <label className="text-xs text-slate-600">To<input type="date" name="to" defaultValue={sp.to} className="ml-1 h-9 rounded-lg border border-slate-300 px-2 text-sm" /></label>
        <Button type="submit" size="sm" variant={p.key === "custom" ? "primary" : "secondary"}>Apply</Button>
      </form>

      {alerts.length > 0 && (
        <Card className="mb-5"><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Needs your attention</CardTitle></CardHeader>
          <ul className="divide-y divide-slate-100">{alerts.map((a, i) => <li key={i}><Link href={a.href} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-slate-50"><span className={cn("h-2 w-2 rounded-full", a.tone === "bad" ? "bg-red-500" : a.tone === "warn" ? "bg-amber-500" : "bg-blue-500")} /><span className="flex-1 text-slate-800">{a.text}</span><ArrowRight className="h-4 w-4 text-slate-400" /></Link></li>)}</ul>
        </Card>
      )}

      <Section title="Projects & sales">
        <StatCard label="Active projects" value={s.activeProjects} href="/projects?status=active" />
        <StatCard label="Delayed" value={s.delayed} tone={s.delayed ? "bad" : "good"} href="/projects?delayed=1" />
        <StatCard label="Starting in 15 days" value={s.startingSoon} />
        <StatCard label="Completed" value={s.completed} tone="good" />
        <StatCard label="New leads (period)" value={s.leadsPeriod} href="/crm/leads" sub={`${s.leadsNew} uncontacted`} />
        <StatCard label="Conversion rate" value={`${s.conversion}%`} sub={`${s.wonPeriod} won this period`} />
        <StatCard label="Quotation value (period)" value={formatINRCompact(s.quoteValue)} sub={`Approved ${formatINRCompact(s.approvedQuoteValue)}`} />
        <StatCard label="Quotations pending" value={s.pendingQuotes} tone={s.pendingQuotes ? "warn" : "default"} href="/sales/quotations?status=PENDING_APPROVAL" />
      </Section>

      {money && (
        <Section title="Money">
          <StatCard label="Revenue received (period)" value={formatINRCompact(s.revenue)} tone="good" />
          <StatCard label="Expenses (period)" value={formatINRCompact(s.expenses)} />
          <StatCard label="Net cash (period)" value={formatINRCompact(s.grossProfit)} tone={s.grossProfit < 0 ? "bad" : "good"} />
          <StatCard label="Receivable" value={formatINRCompact(s.receivable)} href="/finance/receivables" sub={`${formatINRCompact(s.receivableOverdue)} overdue`} tone={s.receivableOverdue ? "warn" : "default"} />
          <StatCard label="Payable" value={formatINRCompact(s.payable)} href="/finance/payables" sub={`${formatINRCompact(s.payableOverdue)} overdue`} />
          <StatCard label="Inventory value" value={formatINRCompact(s.inventoryValue)} href="/inventory/stock" />
          <StatCard label="POs in progress" value={s.posPending} href="/procurement/orders" />
          <StatCard label="Low-stock materials" value={s.lowStock} tone={s.lowStock ? "bad" : "good"} href="/inventory/stock?low=1" />
        </Section>
      )}

      <Section title="People">
        <StatCard label="Employees" value={s.staff} href="/hr/employees" /><StatCard label="Site workers" value={s.workers} href="/workforce/workers" />
        <StatCard label="Workers present today" value={s.presentToday} tone="good" href="/workforce/attendance" /><StatCard label="Pending approvals" value={s.pendingApprovals} tone={s.pendingApprovals ? "warn" : "default"} href="/approvals" />
      </Section>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        {money && <Card><CardHeader><CardTitle>Cash in vs out – 6 months</CardTitle></CardHeader><CardBody><MoneyBars data={s.flow.map((m) => ({ name: m.name, Income: m.income, Expenses: m.expenses }))} series={[{ key: "Income", label: "Received" }, { key: "Expenses", label: "Spent", color: "#c8872e" }]} /></CardBody></Card>}
        <Card><CardHeader><CardTitle>Sales funnel</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/crm/leads?view=board">Pipeline</Link></CardHeader><CardBody><HBars data={s.funnel.filter((f) => !["LOST", "ON_HOLD"].includes(f.name)).map((f) => ({ name: humanize(f.name), value: f.value }))} /></CardBody></Card>
        <Card><CardHeader><CardTitle>Lead sources (period)</CardTitle></CardHeader><CardBody><Donut data={s.sources} /></CardBody></Card>
        <Card><CardHeader><CardTitle>Projects by status</CardTitle></CardHeader><CardBody><Donut data={s.projectStatus.map((x) => ({ name: humanize(x.name), value: x.value }))} /></CardBody></Card>
        {money && <Card><CardHeader><CardTitle>Material purchased by category (period)</CardTitle></CardHeader><CardBody><HBars money data={s.materialSpend.map((m) => ({ name: humanize(m.name), value: m.value }))} /></CardBody></Card>}
        {money && <Card><CardHeader><CardTitle>Vendor payments (period)</CardTitle></CardHeader><CardBody><HBars money data={s.vendorSpend} /></CardBody></Card>}
      </div>

      {c.can("margins:view") && (
        <Card className="mb-5">
          <CardHeader><CardTitle>Project profitability</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/projects">All projects</Link></CardHeader>
          {s.profitability.length === 0 ? <EmptyState title="No project data yet" /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Project</th><th className="px-4 py-2 text-right">Contract</th><th className="px-4 py-2 text-right">Actual cost</th><th className="px-4 py-2 text-right">Profit</th><th className="px-4 py-2 text-right">Margin</th></tr></thead>
              <tbody>{s.profitability.map((x) => <tr key={x.id} className="border-t border-slate-100"><td className="px-4 py-2.5"><Link href={`/projects/${x.id}?tab=financials`} className="font-medium text-slate-900 hover:text-brand-700">{x.code} · {x.name}</Link>{x.over && <Badge tone="red" className="ml-2">Over budget</Badge>}</td><td className="tabular px-4 py-2.5 text-right">{formatINR(x.contract)}</td><td className="tabular px-4 py-2.5 text-right">{formatINR(x.cost)}</td><td className="tabular px-4 py-2.5 text-right">{formatINR(x.profit)}</td><td className={cn("tabular px-4 py-2.5 text-right font-medium", x.cost > 0 && x.margin < 15 ? "text-red-600" : "text-emerald-700")}>{x.cost > 0 ? `${x.margin.toFixed(1)}%` : "—"}</td></tr>)}</tbody></table></div>
          )}
        </Card>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mb-5"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div></section>;
}

/* ───────────────────────── Everyone else: "what do I need to do?" ───────────────────────── */
async function WorkDashboard({ c }: { c: C }) {
  const today = startOfDay();
  const tomorrow = new Date(today.getTime() + 86400000);
  const myProjects = c.can("projects:view") ? await db.project.findMany({ where: { ...projectScope(c), status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: { plannedEndDate: { sort: "asc", nulls: "last" } }, take: 6 }) : [];
  const isSales = c.role === "SALES";
  const myProjectIds = ["PROJECT_MANAGER", "SITE_ENGINEER", "SITE_SUPERVISOR"].includes(c.role) ? (await db.project.findMany({ where: projectScope(c), select: { id: true, code: true } })) : [];

  const [tasks, overdueTasks, approvals, followUps, myLeads, quotes, pos, lowStock, siteToday, leavesPending, pendingPr, unpaidBills, openInvoices, tickets, myQuotesOut] = await Promise.all([
    c.can("tasks:view") ? db.projectTask.findMany({ where: { companyId: c.companyId, assignedToId: c.userId, status: { not: "COMPLETED" }, dueDate: { lt: new Date(today.getTime() + 3 * 86400000) } }, include: { project: { select: { id: true, name: true } } }, orderBy: { dueDate: "asc" }, take: 6 }) : [],
    c.can("tasks:view") ? db.projectTask.count({ where: { companyId: c.companyId, assignedToId: c.userId, status: { not: "COMPLETED" }, dueDate: { lt: today } } }) : 0,
    c.can("approvals:approve") ? db.approval.count({ where: { companyId: c.companyId, status: "PENDING", requestedById: { not: c.userId }, requiredRole: { in: c.role === "PROJECT_MANAGER" ? ["PROJECT_MANAGER"] : c.role === "HR" ? ["HR"] : ["PROJECT_MANAGER", "HR"] } } }) : 0,
    isSales ? db.lead.findMany({ where: { companyId: c.companyId, deletedAt: null, assignedToId: c.userId, nextFollowUp: { lt: tomorrow }, stage: { notIn: ["WON", "LOST"] } }, orderBy: { nextFollowUp: "asc" }, take: 6 }) : [],
    isSales ? db.lead.groupBy({ by: ["stage"], where: { companyId: c.companyId, deletedAt: null, assignedToId: c.userId }, _count: true, _sum: { estimatedValue: true } }) : [],
    isSales ? db.quotation.groupBy({ by: ["status"], where: { companyId: c.companyId, deletedAt: null, preparedById: c.userId }, _count: true, _sum: { total: true } }) : [],
    c.role === "PROCUREMENT" ? db.purchaseOrder.findMany({ where: { companyId: c.companyId, status: { in: ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] } }, include: { vendor: { select: { name: true } } }, orderBy: { deliveryDate: "asc" }, take: 6 }) : [],
    ["PROCUREMENT", "STORE"].includes(c.role) ? db.$queryRaw<{ id: string; name: string; unit: string; qty: number; reorder: number }[]>`SELECT m.id, m.name, m.unit, COALESCE(SUM(b.quantity),0)::float AS qty, m."reorderLevel"::float AS reorder FROM "Material" m LEFT JOIN "StockBalance" b ON b."materialId" = m.id LEFT JOIN "Warehouse" w ON w.id = b."locationId" AND w.type = 'WAREHOUSE' WHERE m."companyId" = ${c.companyId} AND m."deletedAt" IS NULL AND m."reorderLevel" > 0 GROUP BY m.id HAVING COALESCE(SUM(CASE WHEN w.id IS NOT NULL THEN b.quantity ELSE 0 END),0) <= m."reorderLevel" ORDER BY 4 LIMIT 6` : [],
    ["PROJECT_MANAGER", "SITE_ENGINEER", "SITE_SUPERVISOR", "HR"].includes(c.role) ? db.attendance.findMany({ where: { companyId: c.companyId, date: calendarDay(), workerId: { not: null }, status: { in: ["PRESENT", "OVERTIME", "HALF_DAY"] }, ...(c.role === "HR" ? {} : { projectId: { in: myProjectIds.map((p) => p.id) } }) } }) : [],
    c.role === "HR" ? db.leave.count({ where: { companyId: c.companyId, status: "PENDING" } }) : 0,
    c.can("purchase_requests:view") && ["PROJECT_MANAGER", "PROCUREMENT"].includes(c.role) ? db.purchaseRequest.count({ where: { companyId: c.companyId, status: c.role === "PROCUREMENT" ? "APPROVED" : "PENDING_APPROVAL" } }) : 0,
    c.role === "ACCOUNTS" ? db.vendorBill.findMany({ where: { companyId: c.companyId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, include: { vendor: { select: { name: true } } }, orderBy: { dueDate: "asc" }, take: 5 }) : [],
    c.role === "ACCOUNTS" ? db.invoice.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } }, include: { client: { select: { name: true } } }, orderBy: { dueDate: "asc" }, take: 6 }) : [],
    c.can("support:view") && ["PROJECT_MANAGER", "SITE_ENGINEER"].includes(c.role) ? db.supportTicket.findMany({ where: { companyId: c.companyId, assignedToId: c.userId, status: { notIn: ["RESOLVED", "CLOSED"] } }, take: 5 }) : [],
    isSales ? db.quotation.count({ where: { companyId: c.companyId, deletedAt: null, preparedById: c.userId, status: { in: ["SENT", "VIEWED", "NEGOTIATION"] } } }) : 0,
  ]);
  const pipeline = (myLeads as { stage: string; _sum: { estimatedValue: unknown } }[]).filter((x) => !["WON", "LOST"].includes(x.stage)).reduce((s, x) => s + num(x._sum.estimatedValue as number), 0);
  const wonN = (myLeads as { stage: string; _count: number }[]).find((x) => x.stage === "WON")?._count ?? 0;
  const codeOf = new Map(myProjectIds.map((p) => [p.id, p.code]));
  const siteByProject = (siteToday as { projectId: string | null }[]).reduce<Record<string, number>>((a, m) => { const k = codeOf.get(m.projectId ?? "") ?? "Other site"; return { ...a, [k]: (a[k] ?? 0) + 1 }; }, {});
  const openBal = (openInvoices as { total: unknown; paid: unknown }[]).reduce((s, i) => s + num(i.total as number) - num(i.paid as number), 0);

  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${c.name.split(" ")[0]}`} subtitle="Here's what needs your attention today." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {c.can("tasks:view") && <StatCard label="My open tasks" value={tasks.length} sub={overdueTasks ? `${overdueTasks} overdue` : "none overdue"} tone={overdueTasks ? "bad" : "good"} href="/projects/tasks" />}
        {c.can("approvals:approve") && <StatCard label="Waiting for my approval" value={approvals} tone={approvals ? "warn" : "default"} href="/approvals" />}
        {isSales && <StatCard label="Follow-ups due" value={(followUps as unknown[]).length} tone={(followUps as unknown[]).length ? "warn" : "good"} href="/crm/follow-ups" />}
        {isSales && <StatCard label="Open pipeline" value={formatINRCompact(pipeline)} sub={`${wonN} won`} href="/crm/leads?view=board" />}
        {isSales && <StatCard label="Quotations out with clients" value={myQuotesOut} href="/sales/quotations" />}
        {["PROJECT_MANAGER", "SITE_ENGINEER", "SITE_SUPERVISOR", "HR"].includes(c.role) && <StatCard label="Workers on site today" value={(siteToday as unknown[]).length} tone="good" href="/workforce/attendance" />}
        {c.role === "PROCUREMENT" && <StatCard label="Approved requests to order" value={pendingPr} tone={pendingPr ? "warn" : "default"} href="/procurement/requests?status=APPROVED" />}
        {c.role === "PROJECT_MANAGER" && <StatCard label="Requests awaiting approval" value={pendingPr} href="/procurement/requests?status=PENDING_APPROVAL" />}
        {["PROCUREMENT", "STORE"].includes(c.role) && <StatCard label="Low-stock materials" value={(lowStock as unknown[]).length} tone={(lowStock as unknown[]).length ? "bad" : "good"} href="/inventory/stock?low=1" />}
        {c.role === "HR" && <StatCard label="Leave requests pending" value={leavesPending} tone={leavesPending ? "warn" : "default"} href="/hr/leaves?tab=all" />}
        {c.role === "ACCOUNTS" && <StatCard label="Open receivables" value={formatINRCompact(openBal)} href="/finance/receivables" />}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {c.can("tasks:view") && (
          <Card><CardHeader><CardTitle>My tasks</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/projects/tasks">All</Link></CardHeader>
            {tasks.length === 0 ? <EmptyState title="Nothing due soon" /> : <ul className="divide-y divide-slate-100">{tasks.map((t) => <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm"><Clock className={cn("h-4 w-4", t.dueDate && t.dueDate < today ? "text-red-500" : "text-slate-400")} /><div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-900">{t.name}</p><p className="text-xs text-slate-500">{t.project.name}</p></div><span className={cn("text-xs", t.dueDate && t.dueDate < today && "font-semibold text-red-600")}>{formatDate(t.dueDate)}</span></li>)}</ul>}
          </Card>
        )}
        {isSales && (
          <Card><CardHeader><CardTitle>Follow-ups to do</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/crm/follow-ups">All</Link></CardHeader>
            {(followUps as unknown[]).length === 0 ? <EmptyState title="All caught up" /> : <ul className="divide-y divide-slate-100">{(followUps as { id: string; name: string; phone: string | null; nextFollowUp: Date | null; stage: string }[]).map((l) => <li key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm"><CalendarClock className="h-4 w-4 text-slate-400" /><div className="min-w-0 flex-1"><Link href={`/crm/leads/${l.id}`} className="truncate font-medium text-slate-900 hover:text-brand-700">{l.name}</Link><p className="text-xs text-slate-500">{l.phone ?? "no phone"}</p></div><span className={cn("text-xs", l.nextFollowUp && l.nextFollowUp < today && "font-semibold text-red-600")}>{formatDate(l.nextFollowUp)}</span><StatusBadge status={l.stage} /></li>)}</ul>}
          </Card>
        )}
        {myProjects.length > 0 && (
          <Card><CardHeader><CardTitle>My projects</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/projects">All</Link></CardHeader>
            <ul className="divide-y divide-slate-100">{myProjects.map((p) => { const late = p.plannedEndDate && p.plannedEndDate < today; return <li key={p.id} className="px-5 py-3 text-sm"><div className="flex items-center gap-2"><Link href={`/projects/${p.id}`} className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:text-brand-700">{p.name}</Link>{late && <Badge tone="red">Delayed</Badge>}<StatusBadge status={p.status} /></div><div className="mt-1.5 flex items-center gap-2"><Progress value={p.progress} className="flex-1" /><span className="tabular text-xs text-slate-500">{p.progress}% · due {formatDate(p.plannedEndDate)}</span></div></li>; })}</ul>
          </Card>
        )}
        {Object.keys(siteByProject).length > 0 && (
          <Card><CardHeader><CardTitle>On site today</CardTitle></CardHeader><CardBody className="space-y-2 text-sm">{Object.entries(siteByProject).map(([code, n]) => <div key={code} className="flex justify-between"><span>{code}</span><span className="font-semibold">{n} worker(s)</span></div>)}</CardBody></Card>
        )}
        {c.role === "PROCUREMENT" && (
          <Card><CardHeader><CardTitle>Deliveries to chase</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/procurement/deliveries">All</Link></CardHeader>
            {(pos as unknown[]).length === 0 ? <EmptyState title="No open orders" /> : <ul className="divide-y divide-slate-100">{(pos as { id: string; number: string; deliveryDate: Date | null; vendor: { name: string } }[]).map((p) => <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm"><Link href={`/procurement/orders/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.number}</Link><span className="flex-1 text-slate-500">{p.vendor.name}</span><span className={cn("text-xs", p.deliveryDate && p.deliveryDate < today && "font-semibold text-red-600")}>{formatDate(p.deliveryDate)}</span></li>)}</ul>}
          </Card>
        )}
        {["PROCUREMENT", "STORE"].includes(c.role) && (
          <Card><CardHeader><CardTitle>Running low</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/inventory/stock?low=1">All</Link></CardHeader>
            {(lowStock as unknown[]).length === 0 ? <EmptyState title="Stock levels are healthy" /> : <ul className="divide-y divide-slate-100">{(lowStock as { id: string; name: string; unit: string; qty: number; reorder: number }[]).map((m) => <li key={m.id} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="flex-1 font-medium text-slate-900">{m.name}</span><span className="tabular text-red-600">{m.qty} {m.unit}</span><span className="text-xs text-slate-400">reorder at {m.reorder}</span></li>)}</ul>}
          </Card>
        )}
        {c.role === "ACCOUNTS" && (
          <>
            <Card><CardHeader><CardTitle>Invoices to collect</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/finance/receivables">All</Link></CardHeader>
              <ul className="divide-y divide-slate-100">{(openInvoices as { id: string; number: string; dueDate: Date | null; total: unknown; paid: unknown; client: { name: string } }[]).map((i) => <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-sm"><Link href={`/finance/invoices/${i.id}`} className="font-medium text-slate-900 hover:text-brand-700">{i.number}</Link><span className="flex-1 text-slate-500">{i.client.name}</span><span className={cn("text-xs", i.dueDate && i.dueDate < today && "font-semibold text-red-600")}>{formatDate(i.dueDate)}</span><span className="tabular w-24 text-right font-medium">{formatINR(num(i.total as number) - num(i.paid as number))}</span></li>)}</ul>
            </Card>
            <Card><CardHeader><CardTitle>Vendor bills to pay</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/finance/payables">All</Link></CardHeader>
              <ul className="divide-y divide-slate-100">{(unpaidBills as { id: string; number: string; dueDate: Date | null; amount: unknown; paid: unknown; vendor: { name: string } }[]).map((b) => <li key={b.id} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="font-medium text-slate-900">{b.number}</span><span className="flex-1 text-slate-500">{b.vendor.name}</span><span className={cn("text-xs", b.dueDate && b.dueDate < today && "font-semibold text-red-600")}>{formatDate(b.dueDate)}</span><span className="tabular w-24 text-right font-medium">{formatINR(num(b.amount as number) - num(b.paid as number))}</span></li>)}</ul>
            </Card>
          </>
        )}
        {(tickets as unknown[]).length > 0 && (
          <Card><CardHeader><CardTitle>Support tickets for me</CardTitle></CardHeader><ul className="divide-y divide-slate-100">{(tickets as { id: string; subject: string; status: string }[]).map((t) => <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm"><Link href={`/support/${t.id}`} className="flex-1 font-medium text-slate-900 hover:text-brand-700">{t.subject}</Link><StatusBadge status={t.status} /></li>)}</ul></Card>
        )}
        {(quotes as unknown[]).length > 0 && (
          <Card><CardHeader><CardTitle>My quotations</CardTitle></CardHeader><CardBody className="space-y-2 text-sm">{(quotes as { status: string; _count: number; _sum: { total: unknown } }[]).map((q) => <div key={q.status} className="flex items-center justify-between"><StatusBadge status={q.status} /><span className="text-slate-600">{q._count} · {formatINRCompact(num(q._sum.total as number))}</span></div>)}</CardBody></Card>
        )}
        {tasks.length === 0 && !isSales && myProjects.length === 0 && Object.keys(siteByProject).length === 0 && (
          <Card><CardBody className="flex items-center gap-3 text-sm text-slate-600"><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Nothing needs your attention right now.</CardBody></Card>
        )}
      </div>
    </>
  );
}
