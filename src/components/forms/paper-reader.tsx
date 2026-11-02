"use client";
import * as React from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";
import { compressImage } from "@/lib/image-compress";
import { photoProblem } from "@/lib/photo-quality";
import { aiIsOn } from "@/lib/ai-flag";

const FLAG = ["ring-2", "ring-amber-400", "bg-amber-50"];

/**
 * "Read it" bar under a form's file box: the AI reads the chosen paper and fills the boxes of the same form for a person to CHECK.
 * Nothing is saved by it. Boxes it was unsure about turn amber, and typing in one clears the amber. Shown only while the AI switch is ON.
 * `action` gets the file (as `file`) and returns `{ fields, unsure?, note? }` in its data.
 */
export function PaperReader({ formRef, fileField, action, label = "Read the file" }: {
  formRef: React.RefObject<HTMLFormElement | null>;
  fileField: string;
  action: (fd: FormData) => Promise<ActionResult>;
  label?: string;
}) {
  const [on, setOn] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [warn, setWarn] = React.useState<string | null>(null);
  React.useEffect(() => { setOn(aiIsOn()); }, []);

  // a new file: warn about a blurry or dark photo (on the phone, nothing sent), and forget the old message
  React.useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const change = async (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.name !== fileField) return;
      setMsg(null);
      setWarn(aiIsOn() && t.files?.[0] ? await photoProblem(t.files[0]) : null);
    };
    const input = (e: Event) => (e.target as HTMLElement).classList.remove(...FLAG);
    form.addEventListener("change", change);
    form.addEventListener("input", input);
    return () => { form.removeEventListener("change", change); form.removeEventListener("input", input); };
  }, [formRef, fileField]);

  if (!on) return null;

  async function read() {
    const form = formRef.current;
    const input = form?.elements.namedItem(fileField) as HTMLInputElement | null;
    const f = input?.files?.[0];
    if (!form || !f) return void setMsg({ ok: false, text: "Choose the file first." });
    setBusy(true); setMsg(null);
    form.querySelectorAll(".ring-amber-400").forEach((e) => e.classList.remove(...FLAG));
    const fd = new FormData();
    fd.set("file", await compressImage(f));
    const r = await action(fd);
    setBusy(false);
    if (!r.ok) return void setMsg({ ok: false, text: r.error });
    const d = r.data as { fields: Record<string, string>; unsure?: string[]; note?: string | null };
    for (const [name, value] of Object.entries(d.fields)) {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (!el || value === "" || value == null) continue;
      if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === value)) continue;
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    for (const n of d.unsure ?? []) (form.elements.namedItem(n) as HTMLElement | null)?.classList.add(...FLAG);
    setMsg({ ok: true, text: `${r.message ?? "Filled in."}${d.note ? ` ${d.note}` : ""}` });
  }

  return (
    <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/50 p-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="secondary" onClick={() => void read()} loading={busy}><Sparkles className="h-4 w-4" /> {label}</Button>
        <span className="text-xs text-slate-600">Choose the file, press the button, and the boxes fill in. You check them before saving.</span>
      </div>
      {warn && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{warn}</p>}
      {msg && <p className={`flex items-start gap-1.5 text-sm font-medium ${msg.ok ? "text-emerald-800" : "text-amber-700"}`}>{msg.ok && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{msg.text}</span></p>}
    </div>
  );
}
