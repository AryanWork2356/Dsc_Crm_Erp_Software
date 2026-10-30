"use client";
import * as React from "react";
import { Camera, CheckCircle2, Loader2, ScanText } from "lucide-react";
import { compressImage } from "@/lib/image-compress";
import { scanBill } from "@/app/(app)/finance/scan-actions";

const FLAG = ["ring-2", "ring-amber-400", "bg-amber-50"];

/**
 * "Bill photo or PDF" box at the top of the Expense and Vendor bill forms. The file is saved with the record when the form is saved.
 * When reading is switched on, choosing the file also fills the boxes below it; the person checks them, and the boxes the reader was
 * unsure about are shown in amber. Nothing is saved until the person presses Save.
 */
export function BillAttach({ kind, canRead, formRef }: { kind: "expense" | "vendor_bill"; canRead: boolean; formRef: React.RefObject<HTMLFormElement | null> }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [name, setName] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"idle" | "reading" | "done" | "failed">("idle");
  const [msg, setMsg] = React.useState<string | null>(null);

  function field(n: string) { return formRef.current?.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null; }
  function clearFlags() { formRef.current?.querySelectorAll(".ring-amber-400").forEach((e) => e.classList.remove(...FLAG)); }
  // typing in a flagged box means the person has looked at it: the amber goes away
  React.useEffect(() => {
    const f = formRef.current;
    const off = (e: Event) => (e.target as HTMLElement).classList.remove(...FLAG);
    f?.addEventListener("input", off);
    return () => f?.removeEventListener("input", off);
  }, [formRef]);

  async function read() {
    const f = input.current?.files?.[0];
    if (!f) return;
    setState("reading"); setMsg(null); clearFlags();
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("billFile", f);
    const r = await scanBill(fd);
    if (!r.ok) { setState("failed"); setMsg(r.error); return; }
    const { fields, unsure, handwritten, note } = r.data as { fields: Record<string, string>; unsure: string[]; handwritten: boolean; note: string | null };
    for (const [n, v] of Object.entries(fields)) {
      const el = field(n);
      if (!el || v === "") continue;
      if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === v)) continue;
      el.value = v;
    }
    // boxes to look at twice: the ones the reader was unsure about, and the ones it could not fill
    const empty = Object.entries(fields).filter(([n, v]) => v === "" && ["amount", "number", "vendorId", "description"].includes(n)).map(([n]) => n);
    for (const n of new Set([...unsure, ...empty])) field(n)?.classList.add(...FLAG);
    setState("done");
    setMsg([handwritten ? "This looks handwritten: check the amount and the date carefully." : null, note].filter(Boolean).join(" ") || null);
  }

  async function chosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) { setName(null); setState("idle"); return; }
    setName(f.name);
    const small = await compressImage(f); // phone photos shrink to about 300 KB: faster upload, cheaper reading
    if (small !== f && input.current) { const dt = new DataTransfer(); dt.items.add(small); input.current.files = dt.files; }
    if (canRead) await read(); else setState("idle");
  }

  return (
    <div className="sm:col-span-2">
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 px-4 py-4 text-brand-800 active:bg-brand-100">
        {state === "reading" ? <Loader2 className="h-6 w-6 shrink-0 animate-spin" /> : state === "done" ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" /> : <Camera className="h-6 w-6 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{name ?? "Bill photo or PDF"}</span>
          <span className="block text-xs text-brand-700/80">
            {state === "reading" ? "Reading the bill… about 10 seconds" : canRead ? "Take a photo or choose the bill. The boxes below fill in by themselves; you check them." : "Take a photo or choose the bill. It is saved with this record."}
          </span>
        </span>
        <input ref={input} name="billFile" type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => void chosen(e)} />
        <span className="shrink-0 rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-semibold text-white">{name ? "Change" : "Add"}</span>
      </label>
      {state === "done" && <p className="mt-2 flex items-start gap-2 text-sm text-emerald-800"><ScanText className="mt-0.5 h-4 w-4 shrink-0" /><span><b>Filled in from the bill. Please check every box before saving.</b> Boxes in amber were unclear or could not be read.{msg ? ` ${msg}` : ""}</span></p>}
      {state === "failed" && <p className="mt-2 text-sm font-medium text-amber-700">{msg} <span className="font-normal text-slate-600">You can still type the details and save: the photo is kept with the bill.</span></p>}
      {canRead && name && state !== "reading" && <button type="button" onClick={() => void read()} className="mt-2 text-xs font-semibold text-brand-700 hover:underline">Read the bill again</button>}
    </div>
  );
}
