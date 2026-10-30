import type { FieldDef } from "@/components/forms/form-dialog";
import { SEGMENT_OPTS, type Opt } from "@/lib/enums";
import { toDateInput } from "@/lib/utils";

export function projectFields(o: { clients: Opt[]; pms: Opt[]; designers: Opt[]; site: Opt[]; names?: Map<string, string>; showMoney: boolean; project?: Record<string, unknown> | null }): FieldDef[] {
  const p = o.project ?? null;
  const v = (k: string) => (p?.[k] ?? null) as string | number | null;
  // a person already on the project who is no longer in the list (changed role, or an old test login) is kept visible so saving does not drop them
  const withCurrent = (opts: Opt[], key: string): Opt[] => {
    const cur = v(key) as string | null;
    return cur && !opts.some((x) => x.value === cur) ? [...opts, { value: cur, label: `${o.names?.get(cur) ?? "Current person"} (current)` }] : opts;
  };
  const f: FieldDef[] = [
    { name: "name", label: "Project name", required: true, full: true, defaultValue: v("name") },
    { name: "clientId", label: "Client", type: "select", options: o.clients, required: true, defaultValue: v("clientId") },
    { name: "segment", label: "Segment", type: "select", options: SEGMENT_OPTS, defaultValue: (v("segment") as string) ?? "RESIDENTIAL" },
    { name: "siteAddress", label: "Site address", full: true, defaultValue: v("siteAddress") },
    { name: "startDate", label: "Start date", type: "date", defaultValue: toDateInput(p?.startDate as Date | null) },
    { name: "plannedEndDate", label: "Planned completion", type: "date", defaultValue: toDateInput(p?.plannedEndDate as Date | null) },
    { name: "projectManagerId", label: "Project manager", type: "select", options: withCurrent(o.pms, "projectManagerId"), defaultValue: v("projectManagerId") },
    { name: "designerId", label: "Designer", type: "select", options: withCurrent(o.designers, "designerId"), defaultValue: v("designerId") },
    { name: "supervisorId", label: "Project coordinator", type: "select", options: withCurrent(o.site, "supervisorId"), defaultValue: v("supervisorId") },
    ...(p ? [{ name: "dateChangeReason", label: "Why is the completion date changing?", type: "textarea" as const, full: true, hint: "Needed only if you change a date that was already set. It is recorded.", defaultValue: null }] : []),
    { name: "outstation", label: "Outstation site", type: "checkbox", defaultValue: !!p?.outstation, hint: "Outstation sites send their morning update earlier (9:30 instead of 10:00)" },
  ];
  if (o.showMoney) {
    f.push(
      { name: "contractValue", label: "Contract value (₹, excl. GST)", type: "number", defaultValue: p ? Number(p.contractValue) : 0 },
      { name: "budget", label: "Budget (₹)", type: "number", defaultValue: p ? Number(p.budget) : 0, hint: "Usually set from the BOQ estimated cost" },
    );
  }
  return f;
}
