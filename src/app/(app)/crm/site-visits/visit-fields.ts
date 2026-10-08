import type { FieldDef } from "@/components/forms/form-dialog";
import type { Opt } from "@/lib/enums";
import { toDateInput } from "@/lib/utils";

type Args = {
  users: Opt[];
  /** Fixed lead (when scheduling from a lead page) */
  lead?: { id: string; label: string };
  leadOptions?: Opt[];
  clientOptions?: Opt[];
  defaults?: Record<string, unknown>;
  visit?: Record<string, unknown> | null;
};

export function siteVisitFields({ users, lead, leadOptions, clientOptions, defaults = {}, visit = null }: Args): FieldDef[] {
  const v = (k: string) => ((visit?.[k] ?? defaults[k] ?? null) as string | number | null);
  const f: FieldDef[] = [];
  if (lead) f.push({ name: "leadId", label: "Lead", type: "hidden", defaultValue: lead.id });
  else {
    f.push({ name: "leadId", label: "Lead", type: "select", options: leadOptions, defaultValue: v("leadId"), hint: "Pick a lead or a client" });
    f.push({ name: "clientId", label: "Client", type: "select", options: clientOptions, defaultValue: v("clientId") });
  }
  f.push(
    { name: "siteAddress", label: "Site address", required: true, full: true, defaultValue: v("siteAddress") },
    { name: "visitDate", label: "Visit date", type: "date", required: true, defaultValue: toDateInput(visit?.visitDate as Date | null) },
    { name: "visitTime", label: "Time", type: "time", defaultValue: v("visitTime") },
    { name: "assignedToId", label: "Assigned to", type: "select", options: users, defaultValue: v("assignedToId") },
    { name: "estimatedArea", label: "Estimated area (sq ft)", type: "number", defaultValue: visit?.estimatedArea ? Number(visit.estimatedArea) : null },
    { name: "siteCondition", label: "Site condition", type: "textarea", defaultValue: v("siteCondition") },
    { name: "measurements", label: "Measurements", type: "textarea", defaultValue: v("measurements") },
    { name: "requirements", label: "Client requirements", type: "textarea", defaultValue: v("requirements") },
    { name: "notes", label: "Notes", type: "textarea", defaultValue: v("notes") },
    { name: "followUpDate", label: "Follow-up date", type: "date", defaultValue: toDateInput(visit?.followUpDate as Date | null) },
  );
  return f;
}
