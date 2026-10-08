import type { FieldDef } from "@/components/forms/form-dialog";
import type { Opt } from "@/lib/enums";
import { toDateInput } from "@/lib/utils";

export function employeeFields(managers: Opt[], e: Record<string, unknown> | null = null): FieldDef[] {
  const d = (k: string) => (e?.[k] ?? null) as string | null;
  return [
    { name: "name", label: "Full name", required: true, full: true, defaultValue: d("name") },
    { name: "email", label: "Work email", type: "email", defaultValue: d("email") },
    { name: "phone", label: "Phone", type: "tel", defaultValue: d("phone") },
    { name: "designation", label: "Designation", defaultValue: d("designation") },
    { name: "department", label: "Department", defaultValue: d("department"), placeholder: "e.g. Projects, Sales, Finance" },
    { name: "joiningDate", label: "Joining date", type: "date", defaultValue: toDateInput(e?.joiningDate as Date | null) },
    { name: "managerId", label: "Reports to", type: "select", options: managers.filter((m) => m.value !== (e?.id as string)), defaultValue: d("managerId") },
    { name: "workLocation", label: "Work location", defaultValue: d("workLocation") },
    { name: "emergencyContact", label: "Emergency contact", defaultValue: d("emergencyContact") },
  ];
}
