"use client";
import * as React from "react";
import { Languages, Loader2 } from "lucide-react";
import { voiceToEnglish } from "@/app/(app)/ai-actions";

/**
 * A saved voice note: the player, and (only while the AI helper is ON) "Show as English text" under it,
 * which writes out what was said, in English, whatever language was spoken.
 */
export function VoicePlayer({ id, ai }: { id: string; ai: boolean }) {
  const [text, setText] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const r = await voiceToEnglish(id);
    setBusy(false);
    if (r.ok) setText((r.data as { text: string }).text);
    else setErr(r.error);
  }
  return (
    <div className="space-y-1.5">
      <audio controls preload="none" src={`/documents/${id}/download?inline=1`} className="w-full" />
      {ai && !text && (
        <button type="button" onClick={() => void go()} disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />} {busy ? "Listening… (up to a minute)" : "Show as English text"}
        </button>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {text && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800 ring-1 ring-slate-200"><span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">In English (by the AI helper)</span>{text}</p>}
    </div>
  );
}
