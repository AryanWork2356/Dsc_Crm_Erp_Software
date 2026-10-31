import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { userOptions } from "@/lib/lookups";
import { reconcileProject } from "@/lib/waste";
import { calendarDay, cn, formatDate, formatINR, humanize, num, toDateInput } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { recordWaste } from "./actions";
import { USE_SITE_MATERIAL } from "@/lib/features";
import { notFound } from "next/navigation";

export const metadata = { title: "Waste and reconciliation" };

const KINDS = [
  { value: "WASTE", label: "Waste (cut wrongly, spoiled, unusable)" },
  { value: "DAMAGED", label: "Damaged on site or in store" },
  { value: "SUPPLIER_DAMAGE", label: "Damaged when it arrived" },
  { value: "REWORK", label: "Lost in rework" },
  { value: "OFFCUT_REUSABLE", label: "Reusable offcut (kept, not waste)" },
];

export default async function WastePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  if (!USE_SITE_MATERIAL) notFound(); // switched off at DSC (lib/features.ts)
  const c = await requirePerm("inventory:view");
  const { project: pid } = await searchParams;
  const projects = await db.project.findMany({ where: projectScope(c), select: { id: true, code: true, name: true }, orderBy: { code: "asc" }, take: 300 });
  const chosen = projects.find((p) => p.id === pid) ?? null;
  const [rows, materials, team, recon] = await Promise.all([
    db.materialWaste.findMany({ where: { companyId: c.companyId, ...(chosen ? { projectId: chosen.id } : { OR: [{ projectId: { in: projects.map((p) => p.id) } }, { projectId: null }] }) }, orderBy: { date: "desc" }, take: 100 }),
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" }, take: 2000 }),
    userOptions(c.companyId),
    chosen ? reconcileProject(c.companyId, chosen.id) : Promise.resolve([]),
  ]);
  const mat = new Map(materials.map((m) => [m.id, m]));
  const names = new Map(team.map((t) => [t.value, t.label]));
  const code = new Map(projects.map((p) => [p.id, p.code]));
  const lost = rows.filter((r) => r.kind !== "OFFCUT_REUSABLE");
  const lostValue = lost.reduce((s, r) => s + num(r.costValue), 0);

  return (
    <>
      <PageHeader
        title="Waste and reconciliation"
        subtitle="Where did the material go? Waste, damage and reusable offcuts are recorded with a reason and a person to find out why. Stock only ever leaves through a record."
        actions={c.can("inventory:create") && (
          <FormDialog
            title="Record waste, damage or an offcut"
            wide
            trigger={<Button>Record</Button>}
            fields={[
              { name: "kind", label: "What happened?", type: "select", options: KINDS, required: true, full: true, defaultValue: "WASTE" },
              { name: "materialId", label: "Material", type: "select", options: materials.map((m) => ({ value: m.id, label: `${m.name} (${m.unit})` })), required: true, full: true },
              { name: "quantity", label: "How much?", type: "number", required: true },
              { name: "date", label: "Day", type: "date", required: true, defaultValue: toDateInput(calendarDay()) },
              { name: "projectId", label: "Project", type: "select", options: projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })), defaultValue: chosen?.id ?? null, hint: "Its site store is used unless you choose another location" },
              { name: "reason", label: "Why?", type: "textarea", required: true, full: true },
              { name: "ownerId", label: "Who will find out why?", type: "select", options: team, hint: "Needed for everything except a reusable offcut" },
              { name: "actionNote", label: "What will change?", type: "textarea", full: true },
            ]}
            action={recordWaste}
            successMessage="Recorded"
          />
        )}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Records shown" value={rows.length} />
        <StatCard label="Lost (not offcuts)" value={formatINR(lostValue)} tone={lostValue ? "warn" : "default"} sub={`${lost.length} record(s)`} />
        <StatCard label="Reusable offcuts kept" value={rows.filter((r) => r.kind === "OFFCUT_REUSABLE").length} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/inventory/waste" className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium", !chosen ? "border-brand-800 bg-brand-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>All</Link>
        {projects.slice(0, 12).map((p) => <Link key={p.id} href={`/inventory/waste?project=${p.id}`} className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium", chosen?.id === p.id ? "border-brand-800 bg-brand-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>{p.code}</Link>)}
      </div>

      {chosen && (
        <Card className="mb-5">
          <CardHeader><CardTitle>Reconciliation – {chosen.code} · {chosen.name}</CardTitle></CardHeader>
          <p className="px-5 pb-2 text-xs text-slate-500">Issued to the project − returned − waste − what is still at site = what was used. Everything comes from stock records, so the figures balance; an odd &quot;used&quot; number means a count needs checking.</p>
          {recon.length === 0 ? <CardBody className="text-sm text-slate-500">No material has been issued to this project yet.</CardBody> : (
            <Table>
              <THead><tr><Th>Material</Th><Th className="text-right">Issued</Th><Th className="text-right">Returned</Th><Th className="text-right">Waste / damaged</Th><Th className="text-right">Still at site</Th><Th className="text-right">Used (worked out)</Th><Th className="text-right">Reusable offcuts</Th></tr></THead>
              <tbody>
                {recon.map((r) => (
                  <Tr key={r.materialId}>
                    <Td className="font-medium text-slate-900">{r.name} <span className="text-xs text-slate-400">{r.unit}</span></Td>
                    <Td className="text-right">{r.issued}</Td><Td className="text-right">{r.returned}</Td>
                    <Td className={cn("text-right", r.waste > 0 && "text-amber-700")}>{r.waste}{r.wasteValue > 0 && <span className="block text-[11px]">{formatINR(r.wasteValue)}</span>}</Td>
                    <Td className="text-right">{r.atSite}</Td>
                    <Td className={cn("text-right font-semibold", r.used < 0 && "text-red-600")}>{r.used}{r.used < 0 && <span className="block text-[11px] font-normal">check the count</span>}</Td>
                    <Td className="text-right">{r.offcuts}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Records</CardTitle></CardHeader>
        {rows.length === 0 ? <EmptyState title="Nothing recorded" hint="Record waste, damaged material and reusable offcuts here, with the reason." /> : (
          <Table>
            <THead><tr><Th>Day</Th><Th>Material</Th><Th className="text-right">Quantity</Th><Th>What</Th><Th>Project</Th><Th>Why</Th><Th>Looking into it</Th><Th className="text-right">Value</Th></tr></THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap text-sm">{formatDate(r.date)}</Td>
                  <Td className="text-sm font-medium text-slate-900">{mat.get(r.materialId)?.name ?? "—"}</Td>
                  <Td className="text-right">{num(r.quantity)} {r.unit}</Td>
                  <Td><Badge tone={r.kind === "OFFCUT_REUSABLE" ? "teal" : r.kind === "WASTE" ? "amber" : "red"}>{humanize(r.kind)}</Badge></Td>
                  <Td className="text-xs">{r.projectId ? code.get(r.projectId) ?? "—" : "—"}</Td>
                  <Td className="max-w-xs text-xs text-slate-600">{r.reason}{r.actionNote && <span className="block text-slate-400">Change: {r.actionNote}</span>}</Td>
                  <Td className="text-xs">{r.ownerId ? names.get(r.ownerId) ?? "—" : "—"}</Td>
                  <Td className="text-right text-sm">{r.kind === "OFFCUT_REUSABLE" ? "—" : formatINR(r.costValue)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
