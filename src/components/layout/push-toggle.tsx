"use client";
import * as React from "react";
import { BellRing, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { pushPublicKey, removePushSubscription, savePushSubscription } from "@/app/(app)/push-actions";

type State = "checking" | "unsupported" | "ios-install" | "blocked" | "off" | "on";

function keyBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}
async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

/**
 * "Turn on phone alerts": shown until this phone has said yes. Afterwards it is a small line with a way to turn alerts off.
 * On an iPhone it first explains that the app must be on the home screen (Apple allows alerts only there).
 */
export function PushToggle() {
  const toast = useToast();
  const [state, setState] = React.useState<State>("checking");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState(ios && !standalone ? "ios-install" : "unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const allowed = await Notification.requestPermission();
      if (allowed !== "granted") { setState(allowed === "denied" ? "blocked" : "off"); return; }
      const k = await pushPublicKey();
      if (!k.ok || !k.data) throw new Error(k.ok ? "no key" : k.error);
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes((k.data as { key: string }).key) as BufferSource }));
      const r = await savePushSubscription(JSON.stringify(sub), navigator.userAgent);
      if (!r.ok) throw new Error(r.error);
      setState("on");
      toast.success(r.message ?? "Phone alerts are on");
    } catch (e) {
      toast.error(`Could not turn on alerts: ${e instanceof Error ? e.message : "try again"}`);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking" || state === "unsupported") return null;
  if (state === "on") {
    return <p className="mb-4 flex items-center gap-2 text-xs text-emerald-700"><BellRing className="h-4 w-4" /> Phone alerts are on for this phone. <button type="button" className="text-slate-500 underline" onClick={turnOff} disabled={busy}>Turn off</button></p>;
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
      {state === "blocked" ? <BellOff className="h-6 w-6 shrink-0 text-amber-600" /> : <BellRing className="h-6 w-6 shrink-0 text-brand-700" />}
      <div className="min-w-0 flex-1 text-sm">
        {state === "ios-install" && <><p className="font-semibold text-slate-900">Get alerts on this iPhone</p><p className="text-slate-600">First add the app to the Home Screen: in Safari press Share, then “Add to Home Screen”. Open the app from the home screen and press this again.</p></>}
        {state === "blocked" && <><p className="font-semibold text-slate-900">Alerts are blocked on this phone</p><p className="text-slate-600">Open the phone&apos;s Settings, find this app (or the browser), and allow notifications. Then reload this page.</p></>}
        {state === "off" && <><p className="font-semibold text-slate-900">Turn on phone alerts</p><p className="text-slate-600">The day&apos;s work every morning, reminders, and problems on your sites, even when the app is closed.</p></>}
      </div>
      {state === "off" && <Button size="sm" onClick={turnOn} loading={busy}>Turn on</Button>}
    </div>
  );
}
