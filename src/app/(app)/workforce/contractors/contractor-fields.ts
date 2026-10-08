import type { FieldDef } from "@/components/forms/form-dialog";

export function contractorFields(x: Record<string, unknown> | null = null): FieldDef[] {
  const d = (k: string) => (x?.[k] ?? null) as string | number | null;
  return [
    { name: "name", label: "Contractor / firm name", required: true, full: true, defaultValue: d("name") },
    { name: "contactPerson", label: "Contact person", defaultValue: d("contactPerson") },
    { name: "phone", label: "Phone", type: "tel", defaultValue: d("phone") },
    { name: "email", label: "Email", type: "email", defaultValue: d("email") },
    { name: "gstin", label: "GSTIN", defaultValue: d("gstin") },
    { name: "rating", label: "Performance rating (1–5)", type: "number", step: "1", defaultValue: d("rating") },
    { name: "notes", label: "Notes", type: "textarea", defaultValue: d("notes") },
  ];
}
