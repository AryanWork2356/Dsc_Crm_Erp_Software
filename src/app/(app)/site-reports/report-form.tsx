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
type Initial = { manpower: number; progressPct: number | null; workDone: string; planNext: string; materialStatus: "OK" | "SHORT_SOON" | "WORK_STOPPED"; issues: string; existingPhotos: number };

const MATERIAL = [
  { value: "OK", label: "All material is here", hint: "Nothing needed", tone: "border-emerald-500 bg-emerald-50 text-emerald-900" },
  { value: "SHORT_SOON", label: "Material will run short", hint: "Needed in a day or two", tone: "border-amber-500 bg-amber-50 text-amber-900" },
  { value: "WORK_STOPPED", label: "Work stopped – no material", hint: "Urgent", tone: "border-red-500 bg-red-50 text-red-900" },
] as const;

export function ReportForm({ kind, sites, projectId, initial }: { kind: Kind; sites: Site[]; projectId: string; initial: Initial }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [site, setSite] = React.useState(projectId);
  const [manpower, setManpower] = React.useState(initial.manpower);
  const [progress, setProgress] = React.useState<number>(initial.progressPct ?? 0);
  const [material, setMaterial] = React.useState<(typeof MATERIAL)[number]["value"]>(initial.materialStatus);
  const [photos, setPhotos] = React.useState<{ file: File; url: string }[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const morning = kind === "MORNING";

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
    fd.set("manpower", String(manpower));
    if (!morning) fd.set("progressPct", String(progress));
    fd.set("materialStatus", material);
    for (const k of ["workDone", "planNext", "issues"]) if (f.get(k)) fd.set(k, String(f.get(k)));
    photos.forEach((p) => fd.append("photos", p.file));
    setError(null);
    start(async () => {
      const r = await submitSiteReport(fd);
      if (r.ok) {
        toast.success(r.message ?? "Report sent");
        router.push("/site-reports");
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

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">How many people are working on site today?</p>
        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" className="h-14 w-14" onClick={() => setManpower((m) => Math.max(0, m - 1))} aria-label="One less"><Minus className="h-6 w-6" /></Button>
          <input
            inputMode="numeric" aria-label="People on site" value={manpower}
            onChange={(e) => setManpower(Math.max(0, Math.min(2000, Number(e.target.value.replace(/\D/g, "")) || 0)))}
            className="h-14 w-24 rounded-lg border border-slate-300 text-center text-2xl font-semibold"
          />
          <Button type="button" variant="secondary" className="h-14 w-14" onClick={() => setManpower((m) => Math.min(2000, m + 1))} aria-label="One more"><Plus className="h-6 w-6" /></Button>
          <div className="ml-2 flex gap-2">
            {[5, 10].map((n) => <Button key={n} type="button" variant="ghost" className="h-14" onClick={() => setManpower((m) => Math.min(2000, m + n))}>+{n}</Button>)}
          </div>
        </div>
      </div>

      {morning ? (
        <Field label="What is today's plan?" required hint="One or two lines. Example: tile work in master bedroom, electrician for ceiling points.">
          <Textarea name="planNext" rows={3} className="text-base" defaultValue={initial.planNext} />
        </Field>
      ) : (
        <>
          <Field label="What work was done today?" required hint="Example: skirting completed in hall; ceiling grid 60% done.">
            <Textarea name="workDone" rows={3} className="text-base" defaultValue={initial.workDone} />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Site photos <span className="text-red-500">*</span></p>
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
            <label className="mb-2 flex items-baseline justify-between text-sm font-medium text-slate-700">
              <span>How much of the whole site is finished?</span><span className="text-2xl font-semibold text-brand-800">{progress}%</span>
            </label>
            <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="h-3 w-full accent-brand-700" aria-label="Site progress percent" />
          </div>
        </>
      )}

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
        <Field label="Plan for tomorrow (optional)">
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
