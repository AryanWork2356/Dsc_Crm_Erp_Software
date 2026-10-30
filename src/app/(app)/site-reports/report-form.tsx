"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Mic, Plus, Square, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";
import { submitSiteReport } from "./actions";

type Kind = "MORNING" | "EVENING";
type Site = { id: string; label: string };
type Task = { id: string; name: string; zone: string | null; trade: string | null; status: string; progress: number; late: boolean };
type Crew = { trade: string; planned: number; present: number | null };
type Worker = { name: string; taskId: string | null; work: string | null; inTime: string | null; outTime: string | null };
type Initial = { manpower: number; workDone: string; planNext: string; materialStatus: "OK" | "SHORT_SOON" | "WORK_STOPPED"; issues: string; existingPhotos: number };
type Row = Worker & { key: number };

const MATERIAL = [
  { value: "OK", label: "All material is here", hint: "Nothing needed", tone: "border-emerald-500 bg-emerald-50 text-emerald-900" },
  { value: "SHORT_SOON", label: "Material will run short", hint: "Needed in a day or two", tone: "border-amber-500 bg-amber-50 text-amber-900" },
  { value: "WORK_STOPPED", label: "Work stopped – no material", hint: "Urgent", tone: "border-red-500 bg-red-50 text-red-900" },
] as const;
const STEPS = [0, 25, 50, 75, 100];
const OTHER = "__other";
let k = 0;
const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Records a voice note in the browser (Android: WebM, iPhone: MP4). Optional, up to about 3 minutes. */
function VoiceNote({ value, onChange }: { value: File | null; onChange: (f: File | null) => void }) {
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

function PhotoPicker({ label, hint, required, photos, setPhotos, front, max = 10 }: { label: string; hint?: string; required?: boolean; photos: { file: File; url: string }[]; setPhotos: React.Dispatch<React.SetStateAction<{ file: File; url: string }[]>>; front?: boolean; max?: number }) {
  async function add(list: FileList | null) {
    if (!list) return;
    const small = await Promise.all([...list].map((f) => compressImage(f)));
    setPhotos((cur) => [...cur, ...small.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(-max));
  }
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-700">{label} {required && <span className="text-red-500">*</span>}</p>
      <label className="flex h-16 cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 text-base font-medium text-brand-800 active:bg-brand-100">
        {front ? <UserRound className="h-6 w-6" /> : <Camera className="h-6 w-6" />} {front ? "Take your selfie" : "Take or choose photos"}
        <input type="file" accept="image/*" {...(front ? { capture: "user" as const } : {})} multiple={max > 1} className="sr-only" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
      </label>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <li key={p.url} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`${label} ${i + 1}`} className="h-full w-full object-cover" />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((cur) => cur.filter((x) => x !== p))} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReportForm({ kind, sites, projectId, initial, day, canUpdateTasks }: {
  kind: Kind; sites: Site[]; projectId: string; initial: Initial; canUpdateTasks: boolean;
  day: { tasks: Task[]; crew: Crew[]; workers: Worker[]; lastWorkers: Worker[]; knownNames: string[]; hasSelfie: boolean };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [site, setSite] = React.useState(projectId);
  const morning = kind === "MORNING";
  // the worker list: the site attendance (name, work, coming and going time); in the evening it starts from the morning list
  const [rows, setRows] = React.useState<Row[]>(() => day.workers.map((w) => ({ ...w, key: k++, ...(morning ? {} : { outTime: w.outTime ?? nowHHMM() }) })));
  const [done, setDone] = React.useState<Record<string, number>>(() => Object.fromEntries(day.tasks.map((t) => [t.id, t.progress])));
  const [material, setMaterial] = React.useState<(typeof MATERIAL)[number]["value"]>(initial.materialStatus);
  const [selfie, setSelfie] = React.useState<{ file: File; url: string }[]>([]);
  const [photos, setPhotos] = React.useState<{ file: File; url: string }[]>([]);
  const [voice, setVoice] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const listId = React.useId();
  const changed = day.tasks.filter((t) => done[t.id] !== t.progress);

  const tradeOf = new Map(day.tasks.map((t) => [t.id, (t.trade ?? "").toLowerCase()]));
  const shortTrades = morning ? day.crew.filter((c) => rows.filter((r) => r.taskId && tradeOf.get(r.taskId) === c.trade.toLowerCase()).length < c.planned) : [];
  const perWork = new Map<string, number>();
  for (const r of rows) { const w = r.taskId ? day.tasks.find((t) => t.id === r.taskId)?.name ?? "Other" : r.work || "Other"; perWork.set(w, (perWork.get(w) ?? 0) + 1); }

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (w?: Worker) => setRows((rs) => [...rs, { name: w?.name ?? "", taskId: w?.taskId ?? (day.tasks.length === 1 ? day.tasks[0].id : null), work: w?.work ?? null, inTime: morning ? nowHHMM() : null, outTime: morning ? null : nowHHMM(), key: k++ }]);
  const copyLast = () => setRows((rs) => [...rs, ...day.lastWorkers.filter((w) => !rs.some((r) => r.name.toLowerCase() === w.name.toLowerCase())).map((w) => ({ ...w, taskId: w.taskId && day.tasks.some((t) => t.id === w.taskId) ? w.taskId : null, inTime: nowHHMM(), outTime: null, key: k++ }))]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const fd = new FormData();
    fd.set("projectId", site);
    fd.set("kind", kind);
    const list = rows.filter((r) => r.name.trim()).map(({ key: _k, ...r }) => ({ ...r, name: r.name.trim() }));
    fd.set("manpower", String(list.length || initial.manpower));
    if (list.length) fd.set("workers", JSON.stringify(list));
    if (shortTrades.length) fd.set("crewReason", String(f.get("crewReason") ?? ""));
    if (!morning && canUpdateTasks) fd.set("tasks", JSON.stringify(changed.map((t) => ({ id: t.id, progress: done[t.id] }))));
    fd.set("materialStatus", material);
    for (const key of ["workDone", "planNext", "issues"]) if (f.get(key)) fd.set(key, String(f.get(key)));
    if (selfie[0]) fd.set("selfie", selfie[0].file);
    photos.forEach((p) => fd.append("photos", p.file));
    if (voice) fd.set("voice", voice);
    setError(null);
    start(async () => {
      const r = await submitSiteReport(fd);
      if (r.ok) {
        toast.success(r.message ?? "Report sent");
        router.push("/today");
        router.refresh();
      } else setError(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.error);
    });
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6">
      {sites.length > 1 && (
        <Field label="Which site?">
          <Select value={site} onChange={(e) => { setSite(e.target.value); router.replace(`/site-reports/new?project=${e.target.value}&kind=${kind}`); }} className="h-12 text-base">
            {sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Field>
      )}

      {/* the site attendance */}
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">{morning ? "Who is working on site today?" : "Workers today – going time"}</p>
        <p className="mb-3 text-xs text-slate-500">{morning ? "One line per worker: name, the work they are on, the time they came. This is their attendance." : "Put the time each one left. Add anyone who came later."}</p>
        <datalist id={listId}>{day.knownNames.map((n) => <option key={n} value={n} />)}</datalist>
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.key} className="rounded-xl border border-slate-200 p-2">
              <div className="flex items-center gap-2">
                <span className="w-5 text-right text-xs text-slate-400">{i + 1}</span>
                <Input value={r.name} list={listId} onChange={(e) => setRow(r.key, { name: e.target.value })} placeholder="Worker name" className="h-11 flex-1 text-base" aria-label={`Worker ${i + 1} name`} />
                <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove worker ${i + 1}`}><X className="h-4 w-4" /></button>
              </div>
              <div className="mt-2 grid grid-cols-[1fr_auto] gap-2 pl-7">
                {day.tasks.length ? (
                  <Select value={r.taskId ?? (r.work ? OTHER : "")} onChange={(e) => setRow(r.key, e.target.value === OTHER ? { taskId: null, work: r.work ?? "" } : { taskId: e.target.value || null, work: null })} className="h-11 text-sm" aria-label={`Worker ${i + 1} work`}>
                    <option value="">Which work?</option>
                    {day.tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    <option value={OTHER}>Other work…</option>
                  </Select>
                ) : <Input value={r.work ?? ""} onChange={(e) => setRow(r.key, { work: e.target.value })} placeholder="Work (a few words)" className="h-11 text-sm" aria-label={`Worker ${i + 1} work`} />}
                <Input type="time" value={(morning ? r.inTime : r.outTime) ?? ""} onChange={(e) => setRow(r.key, morning ? { inTime: e.target.value } : { outTime: e.target.value })} className="h-11 w-28 text-sm" aria-label={`Worker ${i + 1} ${morning ? "coming" : "going"} time`} />
                {day.tasks.length > 0 && r.taskId === null && r.work !== null && <Input value={r.work} onChange={(e) => setRow(r.key, { work: e.target.value })} placeholder="What work? (a few words)" className="col-span-2 h-10 text-sm" aria-label={`Worker ${i + 1} other work`} />}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="h-11" onClick={() => addRow()}><Plus className="h-4 w-4" /> Add a worker</Button>
          {morning && day.lastWorkers.length > 0 && <Button type="button" variant="ghost" className="h-11" onClick={copyLast}>Same people as last day ({day.lastWorkers.length})</Button>}
        </div>
        {rows.length > 0 && <p className="mt-2 text-sm font-semibold text-slate-800">On site: {rows.filter((r) => r.name.trim()).length} · {[...perWork.entries()].map(([w, n]) => `${w}: ${n}`).join(" · ")}</p>}
        {shortTrades.length > 0 && (
          <Field label={`Fewer than planned: ${shortTrades.map((c) => `${c.trade} (${rows.filter((r) => r.taskId && tradeOf.get(r.taskId) === c.trade.toLowerCase()).length} of ${c.planned})`).join(", ")}. Why?`} required className="mt-3" hint="Recorded against the vendor, and the person who arranges crews is told.">
            <Textarea name="crewReason" rows={2} className="text-base" />
          </Field>
        )}
      </div>

      {morning ? (
        <Field label="What is today's plan?" required hint={day.tasks.length ? "Filled from the schedule. Add or change anything." : "One or two lines. Example: tile work in master bedroom, electrician for ceiling points."}>
          <Textarea name="planNext" rows={3} className="text-base" defaultValue={initial.planNext} />
        </Field>
      ) : (
        <>
          {day.tasks.length > 0 && canUpdateTasks && (
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">How far did today&apos;s work get?</p>
              <p className="mb-3 text-xs text-slate-500">Press how much of each job is finished. This updates the schedule and the project progress.</p>
              <ul className="space-y-3">
                {day.tasks.map((t) => (
                  <li key={t.id} className="rounded-xl border border-slate-200 px-3 py-2">
                    <p className="font-medium text-slate-900">{t.name}{t.late && <span className="ml-2 text-xs font-semibold text-red-600">late</span>}</p>
                    {t.zone && <p className="text-xs text-slate-500">{t.zone}</p>}
                    <div className="mt-2 grid grid-cols-5 gap-1.5">
                      {STEPS.map((v) => (
                        <button key={v} type="button" onClick={() => setDone((d) => ({ ...d, [t.id]: v }))} aria-pressed={done[t.id] === v}
                          className={cn("h-11 rounded-lg border text-sm font-semibold", done[t.id] === v ? (v === 100 ? "border-emerald-600 bg-emerald-600 text-white" : "border-brand-700 bg-brand-700 text-white") : "border-slate-300 bg-white text-slate-700")}>
                          {v === 100 ? "Done" : `${v}%`}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field label={day.tasks.length && canUpdateTasks ? "Anything else done today? (optional)" : "What work was done today?"} required={!(day.tasks.length && canUpdateTasks)} hint="Example: skirting completed in hall; ceiling grid 60% done.">
            <Textarea name="workDone" rows={3} className="text-base" defaultValue={initial.workDone} />
          </Field>
        </>
      )}

      {morning && <PhotoPicker label="Your selfie at the site" required={!day.hasSelfie} hint={day.hasSelfie ? "Already sent this morning. Take a new one only if needed." : "Stand at the site so the place can be seen behind you."} photos={selfie} setPhotos={setSelfie} front max={1} />}
      <PhotoPicker label={morning ? "Site photo (start of the day)" : "End-of-day photos"} required={initial.existingPhotos === 0} photos={photos} setPhotos={setPhotos} />
      {initial.existingPhotos > 0 && <p className="-mt-4 text-xs text-slate-500">{initial.existingPhotos} photo(s) already sent earlier today.</p>}

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Material today</p>
        <div className="grid gap-2">
          {MATERIAL.map((m) => (
            <button key={m.value} type="button" onClick={() => setMaterial(m.value)} aria-pressed={material === m.value}
              className={cn("rounded-xl border-2 px-4 py-3 text-left transition", material === m.value ? m.tone : "border-slate-200 bg-white text-slate-700")}>
              <span className="block text-base font-semibold">{m.label}</span><span className="text-xs opacity-80">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {!morning && (
        <Field label="Plan for tomorrow (optional)" hint="Filled from the schedule.">
          <Textarea name="planNext" rows={2} className="text-base" defaultValue={initial.planNext} />
        </Field>
      )}

      <Field label={morning ? "Notes, problems or help needed (optional)" : "Notes or problems (optional)"} hint="Shortage, delay, client instruction, safety – the project manager is told at once.">
        <Textarea name="issues" rows={2} className="text-base" defaultValue={initial.issues} />
      </Field>
      <VoiceNote value={voice} onChange={setVoice} />

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
      <Button type="submit" size="lg" className="h-14 w-full text-lg" loading={pending}>{pending ? "Sending…" : morning ? "Send morning update" : "Send evening report"}</Button>
    </form>
  );
}
