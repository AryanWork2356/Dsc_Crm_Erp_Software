"use client";
import * as React from "react";
import { Languages, Loader2 } from "lucide-react";
import { toEnglish } from "@/app/(app)/ai-actions";

/** "Show in English": the notes as written stay above; the English version (by the AI helper) appears under them on request. */
export function ShowInEnglish({ items }: { items: { label: string; text: string | null }[] }) {
  const [out, setOut] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const list = items.filter((i) => i.text?.trim());
  if (!list.length) return null;

  async function go() {
    setBusy(true); setErr(null);
    const r = await toEnglish(list.map((i) => i.text ?? ""));
    setBusy(false);
    if (r.ok) setOut((r.data as { texts: string[] }).texts);
    else setErr(r.error);
  }

  return (
    <div className="border-t border-slate-100 pt-4">
      {!out && (
        <button type="button" onClick={() => void go()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-slate-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />} Show in English
        </button>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {out && (
        <div className="space-y-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">In English (by the AI helper)</p>
          {list.map((i, n) => <div key={i.label}><p className="text-xs font-medium text-slate-500">{i.label}</p><p className="whitespace-pre-wrap text-slate-900">{out[n] || "—"}</p></div>)}
        </div>
      )}
    </div>
  );
}
