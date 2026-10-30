import Link from "next/link";
import { needBoard, NEED_LABEL, type NeedRow, type NeedStatus } from "@/lib/material-needs";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { cn, toDateInput } from "@/lib/utils";
import { createMaterialNeed, deleteMaterialNeed, updateMaterialNeed } from "../material-need-actions";

export const NEED_TONE: Record<NeedStatus, "green" | "blue" | "amber" | "red" | "slate"> = { ARRIVED: "green", PART_ARRIVED: "blue", ORDERED: "blue", REQUESTED: "amber", PART_ASKED: "amber", NOT_ASKED: "slate" };
const short = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ""));

/** The materials the schedule needs on this project, and where each one stands. Status is worked out from requests, orders and receipts. */
export async function MaterialNeedsCard({ companyId, projectId, start, tasks, canEdit, canAsk }: { companyId: string; projectId: string; start: Date | null; tasks: { id: string; name: string }[]; canEdit: boolean; canAsk: boolean }) {
  const rows = await needBoard(companyId, [projectId]);
  const dayNo = (d: Date) => (start ? Math.round((d.getTime() - start.getTime()) / 86400000) + 1 : null);
  const form = (r?: NeedRow) => [
    { name: "description", label: "Material", required: true, full: true, placeholder: "e.g. 18 mm BWP plywood", defaultValue: r?.description ?? null, hint: "Type it as it is in the materials list, so it is matched with orders and receipts" },
    { name: "quantity", label: "Quantity", type: "number" as const, required: true, defaultValue: r?.quantity ?? null },
    { name: "unit", label: "Unit", placeholder: "sheets, bags, sqft, nos", defaultValue: r?.unit ?? null },
    { name: "neededBy", label: "Must be on site by", type: "date" as const, required: true, defaultValue: r ? toDateInput(r.neededBy) : null },
    { name: "taskId", label: "For which work", type: "select" as const, options: tasks.map((t) => ({ value: t.id, label: t.name })), defaultValue: r?.taskId ?? null },
    { name: "note", label: "Note", type: "textarea" as const, full: true, defaultValue: r?.note ?? null },
  ];
  const trouble = rows.filter((r) => r.problem).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Materials needed for the schedule{trouble > 0 && <Badge tone="red" className="ml-2">{trouble} need attention</Badge>}</CardTitle>
        {canEdit && <FormDialog title="Add material needed" description="What the work needs, how much, and the day it must be on site. Procurement is warned if nobody has asked for it in time." trigger={<Button size="sm">Add material</Button>} fields={form()} action={createMaterialNeed.bind(null, projectId)} submitLabel="Add" />}
      </CardHeader>
      {rows.length === 0 ? <EmptyState title="No materials listed yet" hint="Upload the schedule with its Materials sheet (Schedule tab), or add each material and the day it is needed. You then get warned before anything is late." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Material</th><th className="px-3 py-2 text-right">Needed</th><th className="px-3 py-2 text-left">On site by</th><th className="px-3 py-2 text-left">Where it stands</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const d = dayNo(r.neededBy);
                return (
                  <tr key={r.id} className={cn("border-t border-slate-100 align-top", r.problem?.severity === "HIGH" && "bg-red-50/50")}>
                    <td className="px-4 py-2.5"><p className="font-medium text-slate-900">{r.description}</p>{r.forWork && <p className="text-xs text-slate-500">for {r.forWork}</p>}{r.note && <p className="text-xs text-slate-500">{r.note}</p>}</td>
                    <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">{qty(r.quantity)} {r.unit}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{short(r.neededBy)}{d !== null && d >= 1 && <span className="text-xs text-slate-500"> · Day {d}</span>}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={NEED_TONE[r.status]}>{NEED_LABEL[r.status]}</Badge>
                      {r.status !== "ARRIVED" && r.status !== "NOT_ASKED" && <span className="ml-2 text-xs text-slate-500">received {qty(r.arrived)} · on order {qty(r.ordered)} · requested {qty(r.asked)}</span>}
                      {r.problem && <p className={cn("mt-1 text-xs font-medium", r.problem.severity === "HIGH" ? "text-red-700" : "text-amber-700")}>{r.problem.text}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {canAsk && (r.status === "NOT_ASKED" || r.status === "PART_ASKED") && <Link href={`/procurement/requests/new?need=${r.id}`}><Button size="sm" variant="secondary">Ask for it</Button></Link>}
                      {canEdit && <FormDialog title="Change material line" trigger={<Button size="sm" variant="ghost">Edit</Button>} fields={form(r)} action={updateMaterialNeed.bind(null, r.id)} />}
                      {canEdit && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteMaterialNeed.bind(null, r.id)} confirm={{ title: `Remove “${r.description}” from the list?`, confirmLabel: "Remove" }}>Remove</ActionButton>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
