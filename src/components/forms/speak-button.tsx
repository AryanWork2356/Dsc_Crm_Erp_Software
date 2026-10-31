"use client";
import * as React from "react";
import { Mic, Square } from "lucide-react";
import { langFromCookie } from "@/lib/lang";
import { cn } from "@/lib/utils";

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

/** The language the phone writes in. Bhojpuri has no speech model of its own: Hindi is the closest. */
export const SPEAK_LANGS = [
  { code: "hi-IN", short: "हिं", label: "Hindi" },
  { code: "en-IN", short: "EN", label: "English" },
  { code: "mr-IN", short: "मरा", label: "Marathi" },
  { code: "gu-IN", short: "ગુ", label: "Gujarati" },
] as const;
const KEY = "dsc-speak-lang";
/** Shown only when the microphone was refused before: the phone then no longer asks by itself. */
const BLOCKED = "Microphone is blocked. Tap the lock icon next to the web address at the top → Microphone → Allow.";
const FROM_APP: Record<string, string> = { hi: "hi-IN", bho: "hi-IN", mr: "mr-IN", gu: "gu-IN", en: "en-IN" };

export function speakLang(): string {
  try { const saved = localStorage.getItem(KEY); if (saved && SPEAK_LANGS.some((l) => l.code === saved)) return saved; } catch { /* private window */ }
  return FROM_APP[langFromCookie(document.cookie)] ?? "en-IN";
}

/** Adds text to a box the same way typing does, so forms that keep their own copy of the text see it too. */
export function appendText(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
  const cur = el.value;
  const next = cur && !/\s$/.test(cur) ? `${cur} ${text}` : `${cur}${text}`;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
  setter ? setter.call(el, next) : (el.value = next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Microphone on a notes box: speak, and the words are written into the box (the phone's own speech-to-text, free, nothing is
 * recorded or sent to us). The small button next to it picks the language the words are written in.
 * Hidden on browsers without speech-to-text (for example Firefox).
 */
export function SpeakButton({ className }: { className?: string }) {
  const [ok, setOk] = React.useState(false);
  const [on, setOn] = React.useState(false);
  const [lang, setLang] = React.useState("en-IN");
  const [err, setErr] = React.useState<string | null>(null);
  const rec = React.useRef<Recognition | null>(null);
  const box = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    setOk(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    setLang(speakLang());
    return () => rec.current?.stop();
  }, []);
  if (!ok) return null;

  const target = () => box.current?.parentElement?.querySelector("textarea, input:not([type=hidden])") as HTMLTextAreaElement | HTMLInputElement | null;

  async function start() {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    const el = target();
    if (!Ctor || !el) return;
    setErr(null);
    // ask for the microphone first: this is what makes the phone show its "Allow" pop-up right here
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      setErr(BLOCKED);
      return;
    }
    const r = new Ctor();
    r.lang = lang;
    r.continuous = false; // one sentence per press: reliable on Android phones
    r.interimResults = false;
    r.onresult = (e) => {
      let said = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += e.results[i][0].transcript;
      if (said.trim()) appendText(el, said.trim());
    };
    r.onerror = (e) => setErr(e.error === "not-allowed" || e.error === "service-not-allowed" ? BLOCKED : e.error === "no-speech" ? "Nothing was heard. Press the mic and speak." : e.error === "network" ? "Speech-to-text needs internet." : null);
    r.onend = () => { setOn(false); rec.current = null; };
    rec.current = r;
    try { r.start(); setOn(true); } catch { setOn(false); }
  }

  function nextLang() {
    const i = SPEAK_LANGS.findIndex((l) => l.code === lang);
    const n = SPEAK_LANGS[(i + 1) % SPEAK_LANGS.length].code;
    setLang(n);
    try { localStorage.setItem(KEY, n); } catch { /* private window */ }
  }

  const cur = SPEAK_LANGS.find((l) => l.code === lang) ?? SPEAK_LANGS[1];
  return (
    <span ref={box} className={cn("notranslate absolute bottom-1.5 right-1.5 flex items-center gap-1", className)} translate="no">
      {err && <span className="max-w-[12rem] rounded bg-white/95 px-1.5 py-0.5 text-[11px] leading-tight text-red-600 shadow-sm">{err}</span>}
      <button type="button" onClick={nextLang} title={`Writes in ${cur.label}. Tap to change.`} aria-label={`Speech language: ${cur.label}. Tap to change.`} className="h-7 min-w-7 rounded-md border border-slate-200 bg-white px-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">{cur.short}</button>
      <button type="button" onClick={() => (on ? rec.current?.stop() : void start())} title={on ? "Stop" : "Speak instead of typing"} aria-label={on ? "Stop listening" : "Speak instead of typing"}
        className={cn("flex h-7 w-7 items-center justify-center rounded-md text-white", on ? "animate-pulse bg-red-600" : "bg-brand-700 hover:bg-brand-800")}>
        {on ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
      </button>
    </span>
  );
}
