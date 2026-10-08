import type { FieldDef } from "@/components/forms/form-dialog";
import type { Opt } from "@/lib/enums";

export function clientFields(pms: Opt[], client: Record<string, unknown> | null = null): FieldDef[] {
  const v = (k: string) => (client?.[k] ?? null) as string | null;
  return [
    { name: "name", label: "Contact name", required: true, defaultValue: v("name") },
    { name: "companyName", label: "Company", defaultValue: v("companyName") },
    { name: "phone", label: "Phone", type: "tel", defaultValue: v("phone") },
    { name: "email", label: "Email", type: "email", defaultValue: v("email") },
    { name: "gstin", label: "GSTIN", defaultValue: v("gstin"), hint: "15 characters, e.g. 27AABCD1234E1Z5" },
    { name: "pan", label: "PAN", defaultValue: v("pan") },
    { name: "address", label: "Address", type: "textarea", defaultValue: v("address") },
    { name: "billingAddress", label: "Billing address (if different)", type: "textarea", defaultValue: v("billingAddress") },
    { name: "projectManagerId", label: "Assigned project manager", type: "select", options: pms, defaultValue: v("projectManagerId") },
    { name: "notes", label: "Notes", type: "textarea", defaultValue: v("notes") },
  ];
}
