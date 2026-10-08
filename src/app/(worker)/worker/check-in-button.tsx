"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

/** One huge button. Location is attached if the phone allows it – never required. */
export function CheckInButton({ action }: { action: (lat?: number, lng?: number) => Promise<ActionResult> }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function go() {
    setBusy(true);
    const pos = await new Promise<GeolocationPosition | null>((res) => {
      if (!("geolocation" in navigator)) return res(null);
      navigator.geolocation.getCurrentPosition((p) => res(p), () => res(null), { timeout: 6000, maximumAge: 60000 });
    });
    const r = await action(pos?.coords.latitude, pos?.coords.longitude);
    setBusy(false);
    if (r.ok) toast.success(r.message ?? "Done"); else toast.error(r.error);
    router.refresh();
  }

  return (
    <button onClick={go} disabled={busy} className="flex w-full flex-col items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-8 text-white shadow-lg active:scale-[0.99] disabled:opacity-70">
      <MapPin className="h-10 w-10" />
      <span className="text-2xl font-bold">{busy ? "Please wait…" : "MARK ATTENDANCE"}</span>
      <span className="text-sm text-white/80">Tap once when you reach the site</span>
    </button>
  );
}
