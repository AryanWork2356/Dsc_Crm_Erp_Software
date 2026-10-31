"use client";
import * as React from "react";
import { Mic, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Records a voice note in the browser (Android: WebM, iPhone: MP4). Optional, up to about 3 minutes. */
export function VoiceNote({ value, onChange }: { value: File | null; onChange: (f: File | null) => void }) {
  const [rec, setRec] = React.useState<MediaRecorder | null>(null);
  const [secs, setSecs] = React.useState(0);
  const [err, setErr] = React.useState<string | null>(null);
  const url = React.useMemo(() => (value ? URL.createObjectURL(value) : null), [value]);
  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  React.useEffect(() => { if (!rec) return; const t = setInterval(() => setSecs((s) => { if (s >= 179) rec.stop(); return s + 1; }), 1000); return () => clearInterval(t); }, [rec]);

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
        onChange(new File(parts, `voice.${ext}`, { type: mime.split(";")[0] }));
        setRec(null);
      };
      r.start();
      setSecs(0);
      setRec(r);
    } catch {
      setErr("The microphone could not be opened. Allow the microphone for this app in the phone settings.");
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-700">Voice note (optional)</p>
      {rec ? (
        <Button type="button" variant="danger" className="h-12 w-full" onClick={() => rec.stop()}><Square className="h-5 w-5" /> Stop recording ({Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")})</Button>
      ) : value && url ? (
        <div className="flex items-center gap-2">
          <audio controls src={url} className="h-10 flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} aria-label="Delete the voice note"><Trash2 className="h-4 w-4" /></Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" className="h-12 w-full" onClick={start}><Mic className="h-5 w-5" /> Record a voice note</Button>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}
