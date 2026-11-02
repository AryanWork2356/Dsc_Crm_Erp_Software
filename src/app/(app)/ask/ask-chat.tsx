"use client";
import * as React from "react";
import { Loader2, Send, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { ask } from "./actions";

type Turn = { role: "user" | "assistant"; text: string };

const EXAMPLES = ["What happened today on all sites?", "Aaj Deshpande site pe kya hua?", "Which sites are behind schedule?", "How much do clients owe us, and who is late paying?", "Profit so far on each project?"];

/** Hindi/Marathi in Devanagari is read in a Hindi voice; everything else in an Indian English voice (the phone's own voice, free). */
const voiceLang = (t: string) => (/[ऀ-ॿ]/.test(t) ? "hi-IN" : "en-IN");

export function AskChat() {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [speaking, setSpeaking] = React.useState<number | null>(null);
  const end = React.useRef<HTMLDivElement>(null);
  // braces on purpose: newer Chrome returns a Promise from scrollIntoView, and an effect must not return one (the screen crashes)
  React.useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns, busy]);
  React.useEffect(() => () => { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }, []);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...turns, { role: "user" as const, text: t }];
    setTurns(next); setQ(""); setErr(null); setBusy(true);
    const r = await ask(next);
    setBusy(false);
    if (r.ok) setTurns([...next, { role: "assistant", text: (r.data as { answer: string }).answer }]);
    else { setErr(r.error); setTurns(turns); setQ(t); }
  }

  function speak(i: number, text: string) {
    if (typeof speechSynthesis === "undefined") return setErr("This phone cannot read text aloud.");
    speechSynthesis.cancel();
    if (speaking === i) return setSpeaking(null);
    const u = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, ""));
    u.lang = voiceLang(text);
    u.onend = () => setSpeaking(null);
    setSpeaking(i);
    speechSynthesis.speak(u);
  }

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => <button key={e} type="button" onClick={() => void send(e)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">{e}</button>)}
        </div>
      )}
      <div className="space-y-3">
        {turns.map((t, i) => (
          <div key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed sm:max-w-[80%]", t.role === "user" ? "bg-brand-800 text-white" : "bg-white text-slate-900 ring-1 ring-slate-200")}>
              {t.text}
              {t.role === "assistant" && (
                <button type="button" onClick={() => speak(i, t.text)} className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-700">
                  {speaking === i ? <><Square className="h-3.5 w-3.5" /> Stop</> : <><Volume2 className="h-4 w-4" /> Listen</>}
                </button>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Looking at your records…</div>}
        <div ref={end} />
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void send(q); }} className="sticky bottom-0 flex items-end gap-2 bg-slate-50 py-2">
        <div className="min-w-0 flex-1"><Textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} placeholder="Ask anything about your sites, materials or money – type or press the mic" className="text-base" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(q); } }} /></div>
        <Button type="submit" disabled={busy || !q.trim()} aria-label="Ask" className="h-12"><Send className="h-5 w-5" /></Button>
      </form>
      <p className="text-xs text-slate-500">Answers come only from your app&apos;s records, in the language you ask in. Nothing is changed. Check important numbers in the app before acting on them.</p>
    </div>
  );
}
