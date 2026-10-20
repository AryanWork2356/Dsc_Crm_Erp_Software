"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

export type Fix = { lat: number; lng: number; accuracy: number; at: number };

/** Asks the phone where it is, as exactly as it can. Resolves to a reason in words when it cannot. */
export function getFix(): Promise<Fix | string> {
  return new Promise((res) => {
    if (!("geolocation" in navigator)) return res("This phone or browser cannot give its location.");
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp }),
      (e) => res(e.code === 1 ? "Location is blocked. Allow location for this app in your phone settings, then try again." : "Could not find your location. Go to an open place and try again."),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/** One huge button. It sends where the phone is; the server only accepts it close to the site. */
export function CheckInButton({ action, label = "MARK ATTENDANCE", hint = "Tap once when you reach the site", compact = false }: {
  action: (lat?: number, lng?: number, accuracy?: number, at?: number) => Promise<ActionResult>;
  label?: string;
  hint?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function go() {
    setBusy(true);
    const fix = await getFix();
    if (typeof fix === "string") {
      setBusy(false);
      toast.error(fix);
      return;
    }
    const r = await action(fix.lat, fix.lng, fix.accuracy, fix.at);
    setBusy(false);
    if (r.ok) toast.success(r.message ?? "Done"); else toast.error(r.error);
    router.refresh();
  }

  return (
    <button onClick={go} disabled={busy} className={compact ? "inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow active:scale-[0.99] disabled:opacity-70" : "flex w-full flex-col items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-8 text-white shadow-lg active:scale-[0.99] disabled:opacity-70"}>
      <MapPin className={compact ? "h-5 w-5" : "h-10 w-10"} />
      <span className={compact ? "" : "text-2xl font-bold"}>{busy ? "Checking your location…" : label}</span>
      {!compact && <span className="text-sm text-white/80">{hint}</span>}
    </button>
  );
}
