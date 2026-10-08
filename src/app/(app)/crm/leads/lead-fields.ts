import type { FieldDef } from "@/components/forms/form-dialog";
import { LEAD_SOURCE_OPTS, PRIORITY_OPTS, SEGMENT_OPTS, type Opt } from "@/lib/enums";
import { toDateInput } from "@/lib/utils";

type LeadLike = Record<string, unknown> | null;

export function leadFields(users: Opt[], lead: LeadLike = null, canAssign = true): FieldDef[] {
  const v = (k: string) => (lead?.[k] ?? null) as string | number | null;
  const fields: FieldDef[] = [
    { name: "name", label: "Contact name", required: true, defaultValue: v("name") },
    { name: "companyName", label: "Company (if any)", defaultValue: v("companyName") },
    { name: "phone", label: "Phone", type: "tel", defaultValue: v("phone") },
    { name: "whatsapp", label: "WhatsApp", type: "tel", defaultValue: v("whatsapp") },
    { name: "email", label: "Email", type: "email", defaultValue: v("email") },
    { name: "source", label: "Lead source", type: "select", options: LEAD_SOURCE_OPTS, defaultValue: v("source") },
    { name: "segment", label: "Segment", type: "select", options: SEGMENT_OPTS, defaultValue: (v("segment") as string) ?? "RESIDENTIAL" },
    { name: "projectType", label: "Project type", placeholder: "e.g. 3BHK full interior, cafe, office", defaultValue: v("projectType") },
    { name: "location", label: "Location", placeholder: "e.g. Thane West", defaultValue: v("location") },
    { name: "estimatedValue", label: "Estimated value (₹)", type: "number", defaultValue: lead?.estimatedValue ? Number(lead.estimatedValue) : null },
    { name: "priority", label: "Priority", type: "select", options: PRIORITY_OPTS, defaultValue: (v("priority") as string) ?? "MEDIUM" },
    { name: "nextFollowUp", label: "Next follow-up", type: "date", defaultValue: toDateInput(lead?.nextFollowUp as Date | null) },
  ];
  if (canAssign) {
    fields.push({ name: "assignedToId", label: "Assigned to", type: "select", options: users, defaultValue: v("assignedToId"), hint: "Leave empty to auto-assign" });
  }
  fields.push(
    { name: "requirement", label: "Requirement", type: "textarea", defaultValue: v("requirement") },
    { name: "notes", label: "Internal notes", type: "textarea", defaultValue: v("notes") },
  );
  return fields;
}
