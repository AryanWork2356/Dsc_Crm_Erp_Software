"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/image-compress";
import { submitSiteReport } from "./actions";

type Kind = "MORNING" | "EVENING";
type Site = { id: string; label: string };
type Task = { id: string; name: string; zone: string | null; trade: string | null; status: string; progress: number; late: boolean };
type Crew = { trade: string; planned: number; present: number | null };
type Initial = { manpower: number; workDone: string; planNext: string; materialStatus: "OK" | "SHORT_SOON" | "WORK_STOPPED"; issues: string; existingPhotos: number };

const MATERIAL = [
  { value: "OK", label: "All material is here", hint: "Nothing needed", tone: "border-emerald-500 bg-emerald-50 text-emerald-900" },
  { value: "SHORT_SOON", label: "Material will run short", hint: "Needed in a day or two", tone: "border-amber-500 bg-amber-50 text-amber-900" },
  { value: "WORK_STOPPED", label: "Work stopped – no material", hint: "Urgent", tone: "border-red-500 bg-red-50 text-red-900" },
] as const;
const STEPS = [0, 25, 50, 75, 100];

function Stepper({ value, onChange, label, big }: { value: number; onChange: (n: number) => void; label: string; big?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" className={big ? "h-14 w-14" : "h-11 w-11"} onClick={() => onChange(Math.max(0, value - 1))} aria-label={`${label}: one less`}><Minus className="h-5 w-5" /></Button>
      <input inputMode="numeric" aria-label={label} value={value} onChange={(e) => onChange(Math.max(0, Math.min(2000, Number(e.target.value.replace(/\D/g, "")) || 0)))}
        className={cn("rounded-lg border border-slate-300 text-center font-semibold", big ? "h-14 w-24 text-2xl" : "h-11 w-16 text-lg")} />
      <Button type="button" variant="secondary" className={big ? "h-14 w-14" : "h-11 w-11"} onClick={() => onChange(Math.min(2000, value + 1))} aria-label={`${label}: one more`}><Plus className="h-5 w-5" /></Button>
    </div>
  );
}

export function ReportForm({ kind, sites, projectId, initial, day, canUpdateTasks }: { kind: Kind; sites: Site[]; projectId: string; initial: Initial; day: { tasks: Task[]; crew: Crew[] }; canUpdateTasks: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [site, setSite] = React.useState(projectId);
  const morning = kind === "MORNING";
  // morning: who came, per trade planned in the schedule (one count for the day: it also fills the Manpower record)
  const [crew, setCrew] = React.useState(day.crew.map((r) => ({ ...r, present: r.present ?? r.planned })));
  const [extra, setExtra] = React.useState(0);
  const [manpower, setManpower] = React.useState(initial.manpower);
  const [done, setDone] = React.useState<Record<string, number>>(() => Object.fromEntries(day.tasks.map((t) => [t.id, t.progress])));
  const [material, setMaterial] = React.useState<(typeof MATERIAL)[number]["value"]>(initial.materialStatus);
  const [photos, setPhotos] = React.useState<{ file: File; url: string }[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const perTrade = morning && crew.length > 0;
  const short = perTrade && crew.some((r) => r.present < r.planned);
  const total = perTrade ? crew.reduce((s, r) => s + r.present, 0) + extra : manpower;
  const changed = day.tasks.filter((t) => done[t.id] !== t.progress);

  React.useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    const small = await Promise.all([...list].map((f) => compressImage(f)));
    setPhotos((cur) => [...cur, ...small.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 10));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const fd = new FormData();
    fd.set("projectId", site);
    fd.set("kind", kind);
    fd.set("manpower", String(total));
    if (perTrade) { fd.set("crew", JSON.stringify(crew.map(({ trade, planned, present }) => ({ trade, planned, present })))); fd.set("crewReason", String(f.get("crewReason") ?? "")); }
    if (!morning && canUpdateTasks) fd.set("tasks", JSON.stringify(changed.map((t) => ({ id: t.id, progress: done[t.id] }))));
    fd.set("materialStatus", material);
    for (const k of ["workDone", "planNext", "issues"]) if (f.get(k)) fd.set(k, String(f.get(k)));
    photos.forEach((p) => fd.append("photos", p.file));
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

      {perTrade ? (
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Who came today?</p>
          <p className="mb-3 text-xs text-slate-500">The plan is from the schedule. Change the number if fewer or more came. This also fills the Manpower record, so it is not typed again.</p>
          <div className="space-y-3">
            {crew.map((r, i) => (
              <div key={r.trade} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2", r.present < r.planned ? "border-amber-400 bg-amber-50" : "border-slate-200")}>
                <div><p className="font-medium text-slate-900">{r.trade}</p><p className="text-xs text-slate-500">planned {r.planned}</p></div>
                <Stepper label={`${r.trade} who came`} value={r.present} onChange={(n) => setCrew((cs) => cs.map((x, j) => (j === i ? { ...x, present: n } : x)))} />
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <div><p className="font-medium text-slate-900">Others</p><p className="text-xs text-slate-500">helpers, anyone not in the plan</p></div>
              <Stepper label="Others on site" value={extra} onChange={setExtra} />
            </div>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-800">On site today: {total}</p>
          {short && (
            <Field label="Why did fewer people come?" required className="mt-3" hint="Recorded against the vendor, and the person who arranges crews is told.">
              <Textarea name="crewReason" rows={2} className="text-base" />
            </Field>
          )}
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">How many people are working on site today?</p>
          <div className="flex items-center gap-3">
            <Stepper big label="People on site" value={manpower} onChange={setManpower} />
            <div className="ml-2 flex gap-2">{[5, 10].map((n) => <Button key={n} type="button" variant="ghost" className="h-14" onClick={() => setManpower((m) => Math.min(2000, m + n))}>+{n}</Button>)}</div>
          </div>
          {!morning && <p className="mt-1 text-xs text-slate-500">Filled from this morning&apos;s update. Change it only if it changed.</p>}
        </div>
      )}

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

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">{morning ? "Start-of-day photo" : "End-of-day photos"} <span className="text-red-500">*</span></p>
        <label className="flex h-16 cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 text-base font-medium text-brand-800 active:bg-brand-100">
          <Camera className="h-6 w-6" /> Take or choose photos
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
        </label>
        {initial.existingPhotos > 0 && <p className="mt-2 text-xs text-slate-500">{initial.existingPhotos} photo(s) already sent earlier today.</p>}
        {photos.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <li key={p.url} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((cur) => cur.filter((x) => x !== p))} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

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

      <Field label={morning ? "Any problem or help needed? (optional)" : "Any problem to report? (optional)"} hint="Shortage, delay, client instruction, safety – the project manager is told at once.">
        <Textarea name="issues" rows={2} className="text-base" defaultValue={initial.issues} />
      </Field>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
      <Button type="submit" size="lg" className="h-14 w-full text-lg" loading={pending}>{pending ? "Sending…" : morning ? "Send morning update" : "Send evening report"}</Button>
    </form>
  );
}
