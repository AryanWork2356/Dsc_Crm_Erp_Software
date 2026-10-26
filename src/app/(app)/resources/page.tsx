import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { userOptions, vendorOptions } from "@/lib/lookups";
import { resourceBoard, syncResourceShortages, TRADES, vendorScores, MIN_DAYS_FOR_SCORE } from "@/lib/resources";
import { calendarDay, cn, formatDate, toDateInput } from "@/lib/utils";
import { PageHeader, StatCard, EmptyState } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog, type FieldDef } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { deleteResourceNeed, logManpower, saveResourceNeed, setResourceCoordinator } from "./actions";

export const metadata = { title: "Manpower" };

const RANGES: Record<string, number> = { "7": 7, "14": 14, "30": 30 };

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const c = await requirePerm("resources:view");
  const { days = "14" } = await searchParams;
  const span = RANGES[days] ?? 14;
  const today = calendarDay();
  const to = new Date(today.getTime() + span * 86400000);
  const wide = ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role);
  const canEdit = c.can("resources:edit");
  const canLog = c.can("resources:create");

  const projects = await db.project.findMany({ where: { ...(wide ? { companyId: c.companyId, deletedAt: null } : projectScope(c)), status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" }, take: 500 });
  if (canEdit) await syncResourceShortages(c.companyId); // raises one action per shortage that is close or has started; closes it when covered
  const rows = await resourceBoard(c.companyId, wide ? null : projects.map((p) => p.id), today, to, today);
  const [vendors, team, settings, usedTrades] = await Promise.all([
    vendorOptions(c.companyId),
    userOptions(c.companyId),
    db.companySettings.findUnique({ where: { companyId: c.companyId }, select: { resourceCoordinatorId: true } }),
    db.resourceNeed.findMany({ where: { companyId: c.companyId }, select: { trade: true }, distinct: ["trade"], take: 50 }),
  ]);
  const vname = new Map(vendors.map((v) => [v.value, v.label]));
  const tradeOpts = [...new Set([...TRADES, ...usedTrades.map((t) => t.trade)])].map((t) => ({ value: t, label: t }));
  const projOpts = projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));
  const scores = await vendorScores(c.companyId);
  const labourVendors = await db.vendor.findMany({ where: { companyId: c.companyId, deletedAt: null, OR: [{ trades: { not: null } }, { id: { in: [...scores.keys()] } }] }, select: { id: true, name: true, tier: true, trades: true, crewSize: true }, orderBy: { name: "asc" }, take: 200 });

  const short = rows.filter((r) => r.status === "SHORT");
  const shortPeople = short.reduce((n, r) => n + r.gap, 0);
  const todayShort = rows.filter((r) => r.plannedToday !== null && r.presentToday !== null && r.presentToday < r.plannedToday);

  const needFields = (r?: (typeof rows)[number]): FieldDef[] => [
    { name: "projectId", label: "Project", type: "select", options: projOpts, required: true, full: true, defaultValue: r?.projectId ?? null },
    { name: "trade", label: "Trade", type: "select", options: tradeOpts, required: true, defaultValue: r?.trade ?? "Carpenter" },
    { name: "required", label: "People needed", type: "number", required: true, defaultValue: r?.required ?? null },
    { name: "fromDate", label: "From", type: "date", required: true, defaultValue: toDateInput(r?.fromDate) },
    { name: "toDate", label: "To", type: "date", required: true, defaultValue: toDateInput(r?.toDate) },
    { name: "vendorId", label: "Vendor (first choice)", type: "select", options: vendors, defaultValue: r?.vendorId ?? null },
    { name: "backupVendorId", label: "Backup vendor", type: "select", options: vendors, defaultValue: r?.backupVendorId ?? null },
    { name: "confirmed", label: "People confirmed so far", type: "number", defaultValue: r?.confirmed ?? 0 },
    { name: "confirmedNote", label: "Who confirmed, and when?", full: true, placeholder: "e.g. Ramesh (vendor) by phone, 27 Oct 4 pm", defaultValue: r?.confirmedNote ?? null, hint: "Required when you confirm people. A vendor's name alone is not a confirmation." },
    { name: "note", label: "Note", type: "textarea", full: true, defaultValue: r?.note ?? null },
  ];

  return (
    <>
      <PageHeader
        title="Manpower"
        subtitle="Who is needed, who is confirmed, and who actually came. A shortage raises one action for the coordinator and closes itself when it is fixed."
        actions={
          <>
            {canLog && (
              <FormDialog
                title="Record today's headcount"
                description="Per trade: how many were planned and how many really came. If fewer came, say why."
                trigger={<Button variant="secondary">Record headcount</Button>}
                fields={[
                  { name: "projectId", label: "Site", type: "select", options: projOpts, required: true, full: true },
                  { name: "date", label: "Day", type: "date", required: true, defaultValue: toDateInput(today) },
                  { name: "trade", label: "Trade", type: "select", options: tradeOpts, required: true, defaultValue: "Carpenter" },
                  { name: "planned", label: "Planned", type: "number", required: true },
                  { name: "present", label: "Came", type: "number", required: true },
                  { name: "late", label: "Of those, late", type: "number", defaultValue: 0 },
                  { name: "vendorId", label: "Vendor", type: "select", options: vendors },
                  { name: "reason", label: "Why were people missing or late?", type: "textarea", full: true },
                  { name: "replacement", label: "What was done about it?", type: "textarea", full: true },
                ]}
                action={logManpower}
                successMessage="Recorded"
              />
            )}
            {canEdit && <FormDialog title="New manpower need" wide trigger={<Button>New need</Button>} fields={needFields()} action={saveResourceNeed.bind(null, null)} successMessage="Saved" />}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Needs in this period" value={rows.length} />
        <StatCard label="Still short" value={short.length} tone={short.length ? "bad" : "good"} sub={short.length ? `${shortPeople} people to confirm` : undefined} />
        <StatCard label="Short today" value={todayShort.length} tone={todayShort.length ? "warn" : "good"} sub="fewer came than planned" />
        <StatCard label="Over-committed vendors" value={rows.filter((r) => r.status === "OVERCOMMITTED").length} tone={rows.some((r) => r.status === "OVERCOMMITTED") ? "warn" : "default"} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.keys(RANGES).map((k) => <Link key={k} href={`/resources?days=${k}`} className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium", String(span) === k ? "border-brand-800 bg-brand-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>Next {k} days</Link>)}
      </div>

      <Card>
        <CardHeader><CardTitle>Needs, by project and trade</CardTitle></CardHeader>
        {rows.length === 0 ? (
          <EmptyState title="No manpower needs in this period" hint="Add what each project needs by trade and dates. Carpenters are the usual bottleneck." />
        ) : (
          <Table>
            <THead><tr><Th>Project</Th><Th>Trade</Th><Th>Dates</Th><Th className="text-right">Needed</Th><Th className="text-right">Confirmed</Th><Th className="text-right">Today</Th><Th>Vendor</Th><Th>Status</Th><Th /></tr></THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="text-sm font-medium text-slate-900">{r.projectLabel}</Td>
                  <Td>{r.trade}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDate(r.fromDate)} – {formatDate(r.toDate)}</Td>
                  <Td className="text-right">{r.required}</Td>
                  <Td className={cn("text-right", r.gap > 0 && "font-semibold text-red-600")}>{r.confirmed}{r.gap > 0 && <span className="block text-[11px] font-normal">{r.gap} short</span>}</Td>
                  <Td className={cn("text-right", r.presentToday !== null && r.plannedToday !== null && r.presentToday < r.plannedToday && "font-semibold text-amber-700")}>{r.presentToday === null ? "—" : `${r.presentToday} / ${r.plannedToday}`}</Td>
                  <Td className="text-xs">{r.vendorId ? vname.get(r.vendorId) ?? "—" : "—"}{r.backupVendorId && <span className="block text-slate-500">backup: {vname.get(r.backupVendorId) ?? "—"}</span>}</Td>
                  <Td><Badge tone={r.status === "SHORT" ? "red" : r.status === "OVERCOMMITTED" ? "amber" : "green"}>{r.status === "SHORT" ? "Short" : r.status === "OVERCOMMITTED" ? "Vendor over-committed" : "Covered"}</Badge></Td>
                  <Td className="text-right">
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <FormDialog title="Change need" wide trigger={<Button size="sm" variant="ghost">Edit</Button>} fields={needFields(r)} action={saveResourceNeed.bind(null, r.id)} />
                        <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteResourceNeed.bind(null, r.id)} confirm={{ title: "Remove this need?", confirmLabel: "Remove" }}>Remove</ActionButton>
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-5">
        <CardHeader><CardTitle>Vendor reliability (last 90 days)</CardTitle></CardHeader>
        <p className="px-5 pb-2 text-xs text-slate-500">Built only from the headcounts supervisors record. People came ÷ people planned, and people on time ÷ people who came. A figure appears after {MIN_DAYS_FOR_SCORE} recorded days.</p>
        {labourVendors.length === 0 ? (
          <CardBody className="text-sm text-slate-500">Add the trades a vendor provides (Procurement → Vendors → Edit) and record headcounts, and reliability appears here.</CardBody>
        ) : (
          <Table>
            <THead><tr><Th>Vendor</Th><Th>Choice</Th><Th>Trades</Th><Th className="text-right">Crew size</Th><Th className="text-right">Days recorded</Th><Th className="text-right">Came ÷ planned</Th><Th className="text-right">On time</Th></tr></THead>
            <tbody>
              {labourVendors.map((v) => {
                const s = scores.get(v.id);
                return (
                  <Tr key={v.id}>
                    <Td className="font-medium text-slate-900"><Link href={`/procurement/vendors/${v.id}`} className="hover:text-brand-700">{v.name}</Link></Td>
                    <Td><Badge tone={v.tier === "PRIMARY" ? "blue" : v.tier === "BACKUP" ? "slate" : "amber"}>{v.tier === "PRIMARY" ? "First choice" : v.tier === "BACKUP" ? "Backup" : "Emergency"}</Badge></Td>
                    <Td className="text-xs">{v.trades ?? "—"}</Td>
                    <Td className="text-right">{v.crewSize ?? "—"}</Td>
                    <Td className="text-right">{s?.days ?? 0}</Td>
                    <Td className={cn("text-right", s?.enough && s.attendancePct !== null && s.attendancePct < 80 && "font-semibold text-red-600")}>{s?.enough ? `${s.attendancePct}%` : <span className="text-xs text-slate-400">not enough records</span>}</Td>
                    <Td className="text-right">{s?.enough && s.punctualityPct !== null ? `${s.punctualityPct}%` : "—"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {c.can("settings:manage") && (
        <p className="mt-5 text-sm text-slate-600">
          Resource coordinator: <b>{settings?.resourceCoordinatorId ? team.find((t) => t.value === settings.resourceCoordinatorId)?.label ?? "—" : "not set (project managers are told instead)"}</b>{" "}
          <FormDialog title="Resource coordinator" description="This person is told first when a crew is short." trigger={<button className="font-medium text-brand-700 hover:underline">Change</button>} fields={[{ name: "userId", label: "Coordinator", type: "select", options: team, defaultValue: settings?.resourceCoordinatorId ?? null }]} action={setResourceCoordinator} />
        </p>
      )}
    </>
  );
}
