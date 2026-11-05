import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { isGiver, isOffice, officePeople } from "@/lib/daily-work";
import { reportDay } from "@/lib/site-reports";
import { ROLE_LABELS } from "@/lib/permissions";
import { cn, formatDate, formatDateTime, formatDuration } from "@/lib/utils";
import { PageHeader, EmptyState, TabLinks, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { giveWork, markWorkDone, removeWork, saveDailyReport } from "./actions";

export const metadata = { title: "Daily work" };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const shift = (key: string, n: number) => dayKey(new Date(new Date(`${key}T00:00:00.000Z`).getTime() + n * 86400000));

export default async function DailyWorkPage({ searchParams }: { searchParams: Promise<{ tab?: string; who?: string; day?: string }> }) {
  const c = await requirePerm("daily_work:view");
  const sp = await searchParams;
  const giver = isGiver(c);
  const office = isOffice(c);
  const tab = sp.tab === "report" ? "report" : "work";
  const today = reportDay();
  const todayKey = dayKey(today);

  const people = giver ? await officePeople(c.companyId) : [];
  const where = giver ? { companyId: c.companyId, ...(sp.who ? { assignedToId: sp.who } : {}) } : { companyId: c.companyId, assignedToId: c.userId };
  const [pending, finished, pendingCount] = await Promise.all([
    db.dailyWork.findMany({ where: { ...where, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.dailyWork.findMany({ where: { ...where, status: "DONE" }, orderBy: { doneAt: "desc" }, take: giver ? 60 : 20 }),
    db.dailyWork.count({ where: { ...where, status: "PENDING" } }),
  ]);
  const ids = [...new Set([...pending, ...finished].flatMap((w) => [w.assignedToId, w.assignedById]))];
  const names = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const now = new Date();
  const took = finished.filter((w) => w.doneAt).map((w) => w.doneAt!.getTime() - w.createdAt.getTime());
  const avgTook = took.length ? took.reduce((a, b) => a + b, 0) / took.length : null;

  // reports
  const day = giver && sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : todayKey;
  const myLogs = office ? await db.dailyLog.findMany({ where: { userId: c.userId }, orderBy: { day: "desc" }, take: 14 }) : [];
  const teamLogs = giver ? await db.dailyLog.findMany({ where: { companyId: c.companyId, day: new Date(`${day}T00:00:00.000Z`) } }) : [];
  const logOf = new Map(teamLogs.map((l) => [l.userId, l]));
  const dayStart = new Date(`${day}T00:00:00+05:30`);
  const dayWork = giver ? await db.dailyWork.findMany({ where: { companyId: c.companyId, OR: [{ createdAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400000) } }, { doneAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400000) } }] } }) : [];
  const statsOf = (uid: string) => {
    const mine = dayWork.filter((w) => w.assignedToId === uid);
    const doneToday = mine.filter((w) => w.doneAt && w.doneAt >= dayStart && w.doneAt < new Date(dayStart.getTime() + 86400000));
    const given = mine.filter((w) => w.createdAt >= dayStart && w.createdAt < new Date(dayStart.getTime() + 86400000)).length;
    const avg = doneToday.length ? doneToday.reduce((a, w) => a + (w.doneAt!.getTime() - w.createdAt.getTime()), 0) / doneToday.length : null;
    return { given, done: doneToday.length, avg };
  };
  const todays = myLogs.find((l) => dayKey(l.day) === todayKey);

  const people_opts = [{ value: "ALL", label: "Everyone in the office" }, ...people.map((p) => ({ value: p.id, label: `${p.name} · ${ROLE_LABELS[p.role]}` }))];

  const Item = ({ w }: { w: (typeof pending)[number] }) => {
    const late = w.status === "PENDING" && w.dueAt && w.dueAt < now;
    return (
      <li className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold text-slate-900">{w.title}</p>
            {w.details && <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600">{w.details}</p>}
          </div>
          {w.status === "DONE" ? <Badge tone="green">Done</Badge> : late ? <Badge tone="red">Late</Badge> : <Badge tone="amber">Pending</Badge>}
        </div>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
          {giver && <div><dt className="inline font-medium text-slate-600">For: </dt><dd className="inline">{names.get(w.assignedToId) ?? "—"}</dd></div>}
          {!giver && <div><dt className="inline font-medium text-slate-600">Given by: </dt><dd className="inline">{names.get(w.assignedById) ?? "—"}</dd></div>}
          <div><dt className="inline font-medium text-slate-600">Given: </dt><dd className="inline">{formatDateTime(w.createdAt)}</dd></div>
          {w.dueAt && <div><dt className="inline font-medium text-slate-600">Finish by: </dt><dd className={cn("inline", late && "font-semibold text-red-600")}>{formatDateTime(w.dueAt)}</dd></div>}
          {w.doneAt && <div><dt className="inline font-medium text-slate-600">Finished: </dt><dd className="inline font-medium text-emerald-700">{formatDateTime(w.doneAt)}</dd></div>}
          {w.doneAt && <div><dt className="inline font-medium text-slate-600">Time taken: </dt><dd className="inline font-semibold text-slate-800">{formatDuration(w.doneAt.getTime() - w.createdAt.getTime())}</dd>{w.dueAt && w.doneAt > w.dueAt && <span className="ml-1 font-medium text-red-600">(late by {formatDuration(w.doneAt.getTime() - w.dueAt.getTime())})</span>}</div>}
          {w.status === "PENDING" && <div><dt className="inline font-medium text-slate-600">Waiting: </dt><dd className={cn("inline", late && "font-semibold text-red-600")}>{formatDuration(now.getTime() - w.createdAt.getTime())} so far</dd></div>}
        </dl>
        {w.doneNote && <p className="mt-1 text-sm text-slate-600">“{w.doneNote}”</p>}
        {w.status === "PENDING" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {w.assignedToId === c.userId && (
              <FormDialog title="Mark this work done" description={w.title} trigger={<Button size="sm">Done</Button>} submitLabel="Mark done"
                fields={[{ name: "note", label: "Anything to add? (optional)", type: "textarea", full: true }]} action={markWorkDone.bind(null, w.id)} />
            )}
            {giver && (
              <ActionButton size="sm" variant="secondary" confirm={{ title: "Take this work back?", body: "It will be removed from their list.", confirmLabel: "Remove" }}
                action={async () => { "use server"; return removeWork(w.id); }}>Remove</ActionButton>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Daily work"
        subtitle={giver ? "Give work to the office team and see when each is finished. Everyone writes a daily report of what they did." : "Work the directors give you, and your own daily report of what you did today."}
        actions={giver && people.length > 0 && (
          <FormDialog title="Give work" description="The time you give it is recorded. They are told, and press Done when it is finished." trigger={<Button>Give work</Button>} submitLabel="Give work"
            fields={[
              { name: "assignedToId", label: "Give to", type: "select", options: people_opts, required: true, defaultValue: sp.who ?? null },
              { name: "title", label: "Work", required: true, full: true, placeholder: "e.g. Send the Thane quotation to the client" },
              { name: "details", label: "Details (optional)", type: "textarea", full: true },
              { name: "dueDate", label: "Finish by (date, optional)", type: "date" },
              { name: "dueTime", label: "Finish by (time)", type: "time", hint: "If you give a date and no time, 6 pm is taken" },
            ]}
            action={giveWork} successMessage="Work given" />
        )}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Average time to finish" value={avgTook === null ? "—" : formatDuration(avgTook)} sub={took.length ? `from ${took.length} finished` : undefined} />
        <StatCard label={giver ? "Work pending" : "Your pending work"} value={pendingCount} tone={pendingCount ? "warn" : "default"} href="/daily-work" />
        {giver ? <StatCard label="Reports in today" value={`${(await db.dailyLog.count({ where: { companyId: c.companyId, day: today } }))} of ${people.length}`} href={`/daily-work?tab=report`} /> : <StatCard label="Today's report" value={todays ? "Written" : "Not yet"} tone={todays ? "good" : "warn"} href="/daily-work?tab=report" />}
      </div>
      <TabLinks current={tab} tabs={[
        { key: "work", label: giver ? "Work given" : "My work", href: "/daily-work", count: pendingCount || undefined },
        { key: "report", label: giver ? "Daily reports" : "My daily report", href: "/daily-work?tab=report" },
      ]} />

      {tab === "work" && (
        <div className="space-y-5">
          {giver && people.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">Show:</span>
              <Link href="/daily-work" className={cn("rounded-full border px-3 py-1.5", !sp.who ? "border-brand-500 bg-brand-50 font-medium text-brand-800" : "border-slate-200 text-slate-700")}>Everyone</Link>
              {people.map((p) => <Link key={p.id} href={`/daily-work?who=${p.id}`} className={cn("rounded-full border px-3 py-1.5", sp.who === p.id ? "border-brand-500 bg-brand-50 font-medium text-brand-800" : "border-slate-200 text-slate-700")}>{p.name}</Link>)}
            </div>
          )}
          <Card>
            <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-800">Pending ({pending.length})</div>
            {pending.length === 0 ? <EmptyState title={giver ? "Nothing pending" : "No work waiting for you"} hint={giver ? "Press Give work to give someone a job." : "When a director gives you work, it shows here and you get a notification."} /> : <ul className="divide-y divide-slate-100">{pending.map((w) => <Item key={w.id} w={w} />)}</ul>}
          </Card>
          <Card>
            <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-800">Finished</div>
            {finished.length === 0 ? <EmptyState title="Nothing finished yet" /> : <ul className="divide-y divide-slate-100">{finished.map((w) => <Item key={w.id} w={w} />)}</ul>}
          </Card>
        </div>
      )}

      {tab === "report" && office && (
        <div className="space-y-5">
          <Card className="p-4 sm:p-5">
            <p className="text-sm text-slate-600">Write what you did today. One report a day: if you write again today, it replaces the first. You can speak it with the mic.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <FormDialog title={todays ? "Today's report" : "Write today's report"} trigger={<Button>{todays ? "Edit today's report" : "Write today's report"}</Button>} submitLabel="Save report"
                fields={[
                  { name: "day", label: "For which day?", type: "date", defaultValue: todayKey, hint: "Today, or up to a week back" },
                  { name: "body", label: "What did you do?", type: "textarea", required: true, full: true, defaultValue: todays?.body ?? null, placeholder: "e.g. Made the Thane BOQ, followed up with 3 clients, updated the vendor list." },
                ]}
                action={saveDailyReport} />
            </div>
          </Card>
          <Card>
            <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-800">Your last reports</div>
            {myLogs.length === 0 ? <EmptyState title="No reports yet" hint="Write today's report above." /> : (
              <ul className="divide-y divide-slate-100">
                {myLogs.map((l) => <li key={l.id} className="px-4 py-3 sm:px-5"><p className="text-xs font-semibold text-slate-500">{formatDate(l.day)}</p><p className="mt-1 whitespace-pre-line break-words text-sm text-slate-800">{l.body}</p></li>)}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "report" && giver && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/daily-work?tab=report&day=${shift(day, -1)}`}><Button variant="secondary" size="sm">‹ Previous day</Button></Link>
            <span className="min-w-32 text-center font-semibold text-slate-800">{formatDate(new Date(`${day}T00:00:00.000Z`))}{day === todayKey ? " (today)" : ""}</span>
            {day < todayKey && <Link href={`/daily-work?tab=report&day=${shift(day, 1)}`}><Button variant="secondary" size="sm">Next day ›</Button></Link>}
          </div>
          <Card>
            {people.length === 0 ? <EmptyState title="No office employees yet" /> : (
              <ul className="divide-y divide-slate-100">
                {people.map((p) => {
                  const l = logOf.get(p.id);
                  return (
                    <li key={p.id} className="px-4 py-3 sm:px-5">
                      <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-slate-900">{p.name}</span><span className="text-xs text-slate-500">{ROLE_LABELS[p.role]}</span>{l ? <Badge tone="green">Written {formatDateTime(l.updatedAt)}</Badge> : <Badge tone="amber">Not written</Badge>}</div>
                      {l && <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{l.body}</p>}
                      {(() => { const st = statsOf(p.id); return (st.given || st.done) ? <p className="mt-1 text-xs text-slate-500">Given work this day: {st.given} · finished: {st.done}{st.avg !== null ? ` · average time ${formatDuration(st.avg)}` : ""}</p> : <p className="mt-1 text-xs text-slate-400">No work was given or finished this day{l ? "" : ", and no report"}.</p>; })()}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
      {tab === "report" && !giver && !office && <EmptyState title="Nothing here for your role" />}
    </>
  );
}
