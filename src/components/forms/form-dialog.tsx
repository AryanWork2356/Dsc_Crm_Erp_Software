"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";
import { readGstin } from "@/lib/gst";
import { BillAttach } from "./bill-attach";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "email" | "tel" | "select" | "textarea" | "checkbox" | "password" | "time" | "hidden" | "file";
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  full?: boolean; // span both columns
  step?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean | null;
};

type Props = {
  title: string;
  description?: string;
  trigger: React.ReactNode;
  fields: FieldDef[];
  action: (fd: FormData) => Promise<ActionResult>;
  submitLabel?: string;
  successMessage?: string;
  wide?: boolean;
  /** Turns on the GSTIN helper: typing a GSTIN fills the PAN and shows the state, and warns about a typing slip. */
  gstHelper?: boolean;
  /** Adds the 'Bill photo or PDF' box (kept with the saved record). `read` also fills the boxes from the bill; a person still checks and saves. */
  bill?: { kind: "expense" | "vendor_bill"; read: boolean };
  /** Called after a successful save with returned data (e.g. to navigate to the new record) */
  onSuccess?: (r: Extract<ActionResult, { ok: true }>) => void;
};

/** Config-driven create/edit dialog. Every field maps 1:1 to a server-side zod schema. */
export function FormDialog({ title, description, trigger, fields, action, submitLabel = "Save", successMessage, wide, gstHelper, bill, onSuccess }: Props) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [open, setOpen] = React.useState(false);
  const [gstNote, setGstNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const autoPan = React.useRef<string | null>(null);

  /** Fill the PAN from the GSTIN (unless the person typed a different one) and say what the GSTIN tells us. */
  function onGstTyped(e: React.FormEvent<HTMLFormElement>) {
    if (!gstHelper || (e.target as HTMLInputElement).name !== "gstin") return;
    const g = (e.target as HTMLInputElement).value.trim().toUpperCase();
    const pan = e.currentTarget.elements.namedItem("pan") as HTMLInputElement | null;
    if (g.length < 15) { setGstNote(null); return; }
    const r = readGstin(g);
    if (!r.pan || !r.state) { setGstNote({ ok: false, text: "This does not look like a GSTIN. It has 15 letters and numbers, for example 27AABCD1234E1Z5." }); return; }
    if (pan && (!pan.value || pan.value === autoPan.current)) { pan.value = r.pan; autoPan.current = r.pan; }
    setGstNote(r.checksumOk ? { ok: true, text: `State: ${r.state}. PAN ${r.pan} filled in.` } : { ok: false, text: `State: ${r.state}, PAN ${r.pan}. But the last character does not match, so please check the number once more.` });
  }
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // unchecked checkboxes are absent from FormData; make them explicit
    for (const f of fields) if (f.type === "checkbox" && !fd.has(f.name)) fd.set(f.name, "off");
    setErrors({});
    setFormError(null);
    start(async () => {
      const r = await action(fd);
      if (r.ok) {
        toast.success(r.message ?? successMessage ?? "Saved");
        setOpen(false);
        router.refresh();
        onSuccess?.(r);
      } else {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.error);
        toast.error(r.error);
      }
    });
  }

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      <Modal open={open} onOpenChange={setOpen} title={title} description={description} wide={wide}>
        <form ref={formRef} onSubmit={submit} onInput={onGstTyped} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {bill && <BillAttach kind={bill.kind} canRead={bill.read} formRef={formRef} />}
            {fields.map((f) => {
              if (f.type === "hidden") return <input key={f.name} type="hidden" name={f.name} value={String(f.defaultValue ?? "")} />;
              const err = errors[f.name];
              const common = { name: f.name, id: f.name, required: f.required, placeholder: f.placeholder };
              let control: React.ReactNode;
              if (f.type === "select") {
                control = (
                  <Select {...common} defaultValue={f.defaultValue === null || f.defaultValue === undefined ? "" : String(f.defaultValue)}>
                    <option value="">{f.required ? "Select…" : "— None —"}</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                );
              } else if (f.type === "textarea") {
                control = <Textarea {...common} defaultValue={(f.defaultValue as string) ?? ""} />;
              } else if (f.type === "file") {
                control = <Input {...common} type="file" className="h-auto py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1 file:text-sm file:font-medium file:text-brand-800" />;
              } else if (f.type === "checkbox") {
                control = (
                  <input type="checkbox" name={f.name} defaultChecked={!!f.defaultValue} className="h-5 w-5 rounded border-slate-300 accent-[#213f72]" />
                );
              } else {
                control = (
                  <Input
                    {...common}
                    type={f.type ?? "text"}
                    step={f.type === "number" ? (f.step ?? "any") : undefined}
                    defaultValue={f.defaultValue === null || f.defaultValue === undefined ? "" : String(f.defaultValue)}
                    autoComplete="off"
                  />
                );
              }
              return (
                <Field key={f.name} label={f.label} error={err} hint={f.hint} required={f.required} className={f.full || f.type === "textarea" ? "sm:col-span-2" : undefined}>
                  {control}
                </Field>
              );
            })}
          </div>
          {gstNote && <p className={`text-sm font-medium ${gstNote.ok ? "text-emerald-700" : "text-amber-700"}`}>{gstNote.text}</p>}
          {formError && !Object.keys(errors).length && <p className="text-sm font-medium text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
