"use client";
import * as React from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const MAX_VOICE_NOTES = 5;

/**
 * Records voice notes in the browser (Android: WebM, iPhone: MP4), up to about 3 minutes each and MAX_VOICE_NOTES in all.
 * Each recording is listed with a player and a delete button; "Record another" adds one more.
 */
export function VoiceNote({ value, onChange }: { value: File[]; onChange: (f: File[]) => void }) {
  const [rec, setRec] = React.useState<MediaRecorder | null>(null);
  const [secs, setSecs] = React.useState(0);
  const [err, setErr] = React.useState<string | null>(null);
  const urls = React.useMemo(() => value.map((f) => URL.createObjectURL(f)), [value]);
  React.useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  React.useEffect(() => { if (!rec) return; const t = setInterval(() => setSecs((s) => { if (s >= 179) rec.stop(); return s + 1; }), 1000); return () => clearInterval(t); }, [rec]);
  const latest = React.useRef(value);
  latest.current = value;

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const parts: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = r.mimeType || type || "audio/webm";
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        onChange([...latest.current, new File(parts, `voice-${latest.current.length + 1}.${ext}`, { type: mime.split(";")[0] })]);
        setRec(null);
      };
      r.start();
      setSecs(0);
      setRec(r);
    } catch {
      setErr("Microphone is blocked. Tap the lock icon next to the web address at the top → Microphone → Allow.");
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-700">Voice notes (optional)</p>
      {value.length > 0 && (
        <ul className="mb-2 space-y-2">
          {value.map((f, i) => (
            <li key={urls[i]} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-xs font-semibold text-slate-500">{i + 1}.</span>
              <audio controls src={urls[i]} className="h-10 min-w-0 flex-1" />
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((x) => x !== f))} aria-label={`Delete voice note ${i + 1}`}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      {rec ? (
        <Button type="button" variant="danger" className="h-12 w-full" onClick={() => rec.stop()}><Square className="h-5 w-5" /> Stop recording ({Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")})</Button>
      ) : value.length < MAX_VOICE_NOTES ? (
        <Button type="button" variant="secondary" className="h-12 w-full" onClick={start}><Mic className="h-5 w-5" /> {value.length ? "Record another voice note" : "Record a voice note"}</Button>
      ) : (
        <p className="text-xs text-slate-500">{MAX_VOICE_NOTES} voice notes is the most for one entry.</p>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}
