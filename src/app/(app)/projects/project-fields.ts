import type { FieldDef } from "@/components/forms/form-dialog";
import { SEGMENT_OPTS, type Opt } from "@/lib/enums";
import { toDateInput } from "@/lib/utils";

export function projectFields(o: { clients: Opt[]; pms: Opt[]; staff: Opt[]; showMoney: boolean; project?: Record<string, unknown> | null }): FieldDef[] {
  const p = o.project ?? null;
  const v = (k: string) => (p?.[k] ?? null) as string | number | null;
  const f: FieldDef[] = [
    { name: "name", label: "Project name", required: true, full: true, defaultValue: v("name") },
    { name: "clientId", label: "Client", type: "select", options: o.clients, required: true, defaultValue: v("clientId") },
    { name: "segment", label: "Segment", type: "select", options: SEGMENT_OPTS, defaultValue: (v("segment") as string) ?? "RESIDENTIAL" },
    { name: "siteAddress", label: "Site address", full: true, defaultValue: v("siteAddress") },
    { name: "startDate", label: "Start date", type: "date", defaultValue: toDateInput(p?.startDate as Date | null) },
    { name: "plannedEndDate", label: "Planned completion", type: "date", defaultValue: toDateInput(p?.plannedEndDate as Date | null) },
    { name: "projectManagerId", label: "Project manager", type: "select", options: o.pms, defaultValue: v("projectManagerId") },
    { name: "designerId", label: "Designer", type: "select", options: o.staff, defaultValue: v("designerId") },
    { name: "siteEngineerId", label: "Site engineer", type: "select", options: o.staff, defaultValue: v("siteEngineerId") },
    { name: "supervisorId", label: "Site supervisor", type: "select", options: o.staff, defaultValue: v("supervisorId") },
  ];
  if (o.showMoney) {
    f.push(
      { name: "contractValue", label: "Contract value (₹, excl. GST)", type: "number", defaultValue: p ? Number(p.contractValue) : 0 },
      { name: "budget", label: "Budget (₹)", type: "number", defaultValue: p ? Number(p.budget) : 0, hint: "Usually set from the BOQ estimated cost" },
    );
  }
  return f;
}
