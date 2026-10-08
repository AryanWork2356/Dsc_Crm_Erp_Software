import type { FieldDef } from "@/components/forms/form-dialog";

export function vendorFields(v: Record<string, unknown> | null = null, showBank = false): FieldDef[] {
  const d = (k: string) => (v?.[k] ?? null) as string | number | null;
  return [
    { name: "name", label: "Vendor / company name", required: true, full: true, defaultValue: d("name") },
    { name: "contactPerson", label: "Contact person", defaultValue: d("contactPerson") },
    { name: "phone", label: "Phone", type: "tel", defaultValue: d("phone") },
    { name: "whatsapp", label: "WhatsApp", type: "tel", defaultValue: d("whatsapp") },
    { name: "email", label: "Email", type: "email", defaultValue: d("email") },
    { name: "gstin", label: "GSTIN", defaultValue: d("gstin") },
    { name: "pan", label: "PAN", defaultValue: d("pan") },
    { name: "categories", label: "What they supply", placeholder: "e.g. Plywood, laminates, hardware", defaultValue: d("categories") },
    { name: "rating", label: "Quality rating (1–5)", type: "number", step: "1", defaultValue: d("rating") },
    { name: "address", label: "Address", type: "textarea", defaultValue: d("address") },
    ...(showBank ? [{ name: "bankDetails", label: "Bank details", type: "textarea" as const, defaultValue: d("bankDetails") }] : []),
    { name: "notes", label: "Notes", type: "textarea", defaultValue: d("notes") },
  ];
}
