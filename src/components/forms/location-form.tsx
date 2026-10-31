"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Crosshair, ExternalLink, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

/**
 * Sets a place on the map: stand there and press "Use my current location", or type the numbers.
 * Used for a project's site and for the office.
 */
export function LocationForm({ action, lat, lng, radius, radiusHint, requireRadius, extra, canEdit = true }: {
  action: (fd: FormData) => Promise<ActionResult>;
  lat: number | null;
  lng: number | null;
  radius: number | null;
  radiusHint: string;
  requireRadius?: boolean;
  extra?: React.ReactNode;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [la, setLa] = React.useState(lat?.toString() ?? "");
  const [ln, setLn] = React.useState(lng?.toString() ?? "");
  const [pending, start] = React.useTransition();
  const [locating, setLocating] = React.useState(false);
  // once a place is saved it is shown as one line with an Edit button; the boxes open again on Edit
  const [saved, setSaved] = React.useState<{ lat: string; lng: string; radius: string } | null>(lat != null && lng != null ? { lat: String(lat), lng: String(lng), radius: radius?.toString() ?? "" } : null);
  const [editing, setEditing] = React.useState(!saved);

  function here() {
    if (!("geolocation" in navigator)) return void toast.error("This phone or browser cannot give its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLa(p.coords.latitude.toFixed(6)); setLn(p.coords.longitude.toFixed(6)); setLocating(false); toast.success(`Location taken (accurate to about ${Math.round(p.coords.accuracy)} m). Press Save.`); },
      () => { setLocating(false); toast.error("Could not get the location. Allow location for this site and try again."); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }
  function save(fd: FormData) {
    start(async () => {
      const r = await action(fd);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        setSaved({ lat: String(fd.get("lat") ?? "").trim(), lng: String(fd.get("lng") ?? "").trim(), radius: String(fd.get("radius") ?? "").trim() });
        setEditing(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  const has = la.trim() && ln.trim();
  if (saved && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
        <span className="font-semibold text-emerald-800">✓ Saved</span>
        <span className="tabular text-slate-700">{saved.lat}, {saved.lng}</span>
        <span className="text-slate-600">Allowed distance: {saved.radius ? `${saved.radius} m` : radiusHint.toLowerCase()}</span>
        <a href={`https://www.google.com/maps?q=${saved.lat},${saved.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><ExternalLink className="h-4 w-4" /> See on map</a>
        {canEdit && <Button type="button" size="sm" variant="secondary" className="ml-auto" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit</Button>}
      </div>
    );
  }
  return (
    <form action={save} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium text-slate-700">Latitude<Input name="lat" value={la} onChange={(e) => setLa(e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="19.218331" className="mt-1" /></label>
        <label className="text-sm font-medium text-slate-700">Longitude<Input name="lng" value={ln} onChange={(e) => setLn(e.target.value)} disabled={!canEdit} inputMode="decimal" placeholder="72.978089" className="mt-1" /></label>
        <label className="text-sm font-medium text-slate-700">Allowed distance (metres)<Input name="radius" type="number" min="5" max="500" step="1" defaultValue={saved ? saved.radius : radius ?? ""} disabled={!canEdit} required={requireRadius} placeholder={radiusHint} className="mt-1" /></label>
      </div>
      {extra}
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && <Button type="button" variant="secondary" onClick={here} loading={locating}><Crosshair className="h-4 w-4" /> Use my current location</Button>}
        {canEdit && <Button type="submit" loading={pending}>Save</Button>}
        {saved && <Button type="button" variant="ghost" onClick={() => { setLa(saved.lat); setLn(saved.lng); setEditing(false); }}>Cancel</Button>}
        {has && <a href={`https://www.google.com/maps?q=${la.trim()},${ln.trim()}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><ExternalLink className="h-4 w-4" /> See on map</a>}
      </div>
      <p className="text-xs text-slate-500">Tip: stand at the middle of the site or the main door, press <b>Use my current location</b>, wait for the message, then <b>Save</b>.</p>
    </form>
  );
}
