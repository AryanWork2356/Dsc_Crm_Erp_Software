"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Download, ExternalLink, MoreVertical, Share, X } from "lucide-react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// The browser offers the install prompt only once and often before a page has finished loading, so it is caught here,
// as soon as this file is loaded (the root layout loads it on every page), and kept for whichever button wants it.
let deferred: InstallEvent | null = null;
let installedNow = false;
const READY = "dsc-install-ready";
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; window.dispatchEvent(new Event(READY)); });
  window.addEventListener("appinstalled", () => { installedNow = true; deferred = null; window.dispatchEvent(new Event(READY)); });
}

const HIDE_KEY = "dsc-install-hidden-until"; // "not now": do not ask again for a week
const DONE_KEY = "dsc-install-done"; // installed on this phone: never ask again
const readKey = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeKey = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: just ask again next time */ } };

/** Registers the service worker (production only, so development is never confused by caching). */
export function PwaRegister() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

export type InstallState = {
  ready: boolean; // the page has worked out what this device is
  installed: boolean; // already installed, or running as the installed app
  ios: boolean;
  phone: boolean;
  inAppBrowser: boolean; // WhatsApp, Instagram, Facebook … cannot install apps: the link must be opened in Chrome or Safari
  canPrompt: boolean; // Chrome can show its real "Install app" window right now
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
  markDone: () => void;
};

/** What this phone or computer can do about installing the app. */
export function useInstall(): InstallState {
  const [, bump] = React.useState(0);
  const [env, setEnv] = React.useState({ ready: false, standalone: false, ios: false, phone: false, inApp: false, related: false, done: false });

  React.useEffect(() => {
    const ua = navigator.userAgent;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) writeKey(DONE_KEY, "1"); // on Android the installed app and Chrome share this memory
    const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1); // iPads say they are Macs
    setEnv({
      ready: true, standalone, ios, phone: ios || /android|mobile/i.test(ua),
      inApp: /FBAN|FBAV|Instagram|WhatsApp|Line\/|Telegram|; wv\)|Snapchat|LinkedInApp/i.test(ua),
      related: false, done: readKey(DONE_KEY) === "1",
    });
    // Android Chrome can tell us the app is already installed on this phone, even when it is opened in a normal tab
    const rel = (navigator as unknown as { getInstalledRelatedApps?: () => Promise<unknown[]> }).getInstalledRelatedApps;
    if (rel) void rel.call(navigator).then((apps) => { if (apps.length) setEnv((e) => ({ ...e, related: true })); }).catch(() => {});
    const on = () => bump((n) => n + 1);
    window.addEventListener(READY, on);
    return () => window.removeEventListener(READY, on);
  }, []);

  const markDone = React.useCallback(() => { writeKey(DONE_KEY, "1"); setEnv((e) => ({ ...e, done: true })); }, []);
  const install = React.useCallback(async () => {
    const e = deferred;
    if (!e) return "unavailable" as const;
    await e.prompt();
    const r = await e.userChoice.catch(() => ({ outcome: "dismissed" }));
    deferred = null;
    bump((n) => n + 1);
    if (r.outcome === "accepted") markDone();
    return r.outcome === "accepted" ? ("accepted" as const) : ("dismissed" as const);
  }, [markDone]);

  return { ready: env.ready, installed: env.standalone || installedNow || env.related || env.done, ios: env.ios, phone: env.phone, inAppBrowser: env.inApp, canPrompt: !!deferred, install, markDone };
}

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-800 text-xs font-bold text-white">{n}</span><span className="text-sm leading-relaxed text-slate-700">{children}</span></li>
);

/** The steps for a phone that has no one-tap install window (every iPhone, and an Android Chrome that has not offered one). */
function StepsList({ ios }: { ios: boolean }) {
  return ios ? (
    <ol className="space-y-3">
      <Step n={1}>Tap the <Share className="mx-1 inline h-4 w-4" /> <b>Share</b> button at the bottom of <b>Safari</b>.</Step>
      <Step n={2}>Scroll down and tap <b>Add to Home Screen</b>.</Step>
      <Step n={3}>Tap <b>Add</b>. The DSC icon appears on your home screen.</Step>
    </ol>
  ) : (
    <ol className="space-y-3">
      <Step n={1}>In <b>Chrome</b>, tap the <MoreVertical className="mx-0.5 inline h-4 w-4" /> menu at the top right.</Step>
      <Step n={2}>Tap <b>Install app</b>. <span className="text-slate-500">If you only see &ldquo;Add to Home screen&rdquo;, tap that and then choose <b>Install</b>.</span></Step>
      <Step n={3}>Tap <b>Install</b>. The DSC icon appears with your other apps.</Step>
    </ol>
  );
}

/**
 * One install flow for every button. On Android Chrome a tap opens Chrome's real install window; where the browser does not
 * offer one (and always on iPhone) it opens a sheet with the steps. Nothing shows once the app is installed.
 */
export function useInstallFlow() {
  const s = useInstall();
  const [steps, setSteps] = React.useState(false);
  const show = s.ready && s.phone && !s.installed && !s.inAppBrowser;
  async function tap(onAccepted?: () => void) {
    if (s.canPrompt) { if ((await s.install()) === "accepted") onAccepted?.(); }
    else setSteps(true);
  }
  const sheet = steps ? (
    <div role="dialog" aria-label="Install the DSC app" className="fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl bg-white p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl ring-1 ring-slate-200">
      <button onClick={() => setSteps(false)} className="absolute right-4 top-4 rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
      <p className="text-lg font-semibold text-slate-900">Put DSC on your home screen</p>
      <div className="mt-3"><StepsList ios={s.ios} /></div>
      <div className="mt-5 flex gap-2">
        <button onClick={() => { s.markDone(); setSteps(false); }} className="flex-1 rounded-xl bg-brand-800 py-3 text-sm font-semibold text-white">I have done it</button>
        <button onClick={() => setSteps(false)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-600">Close</button>
      </div>
    </div>
  ) : null;
  return { s, show, tap, sheet };
}

/** Small "Install app" button for the top bar. */
export function InstallApp() {
  const { show, tap, sheet } = useInstallFlow();
  if (!show) return null;
  return (
    <>
      <button onClick={() => void tap()} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100" title="Install the DSC app on this phone" aria-label="Install the DSC app">
        <Download className="h-4 w-4" /> <span className="hidden sm:inline">Install app</span>
      </button>
      {sheet}
    </>
  );
}

/** The BIG install button on the sign-in page, under the Sign in button. Only on phones, and only until the app is installed. */
export function InstallCta() {
  const { s, show, tap, sheet } = useInstallFlow();
  if (s.ready && s.phone && !s.installed && s.inAppBrowser) {
    return <p className="mt-5 rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-900 ring-1 ring-amber-200">To install the app, open this page in <b>{s.ios ? "Safari" : "Chrome"}</b> (tap the menu at the top, then <b>Open in browser</b>).</p>;
  }
  if (!show) return null;
  return (
    <>
      <button type="button" onClick={() => void tap()} className="mt-5 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-[#361210] to-[#5b2619] p-4 text-left text-white shadow-lg ring-1 ring-amber-300/30 transition active:scale-[0.99]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl ring-1 ring-amber-200/40" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold leading-tight">Install the DSC app</span>
          <span className="mt-0.5 block text-xs text-amber-100/80">One tap. Opens full screen, updates itself.</span>
        </span>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[#361210]"><Download className="h-5 w-5" /></span>
      </button>
      {sheet}
    </>
  );
}

/**
 * The "Install the DSC app" card that slides in at the top of a PHONE as soon as the page opens. It never shows when the app is
 * already installed or is being opened from the home screen, after "Not now" (for a week), or on a computer.
 */
export function InstallBanner() {
  const { show, tap, sheet } = useInstallFlow();
  const path = usePathname();
  const [hidden, setHidden] = React.useState(true);
  React.useEffect(() => { setHidden(Number(readKey(HIDE_KEY) ?? 0) > Date.now()); }, []);
  if (!show || hidden || path.startsWith("/install")) return null;
  const later = () => { writeKey(HIDE_KEY, String(Date.now() + 7 * 86400000)); setHidden(true); };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div role="dialog" aria-label="Install the DSC app banner" className="anim-fade-up pointer-events-auto mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-gradient-to-r from-[#361210] to-[#5b2619] p-3 pr-2 text-white shadow-2xl shadow-black/40 ring-1 ring-amber-300/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl ring-1 ring-amber-200/40" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Install the DSC app</p>
            <p className="mt-0.5 text-xs leading-snug text-amber-100/80">Opens full screen in one tap. Free, and it updates itself.</p>
          </div>
          <button onClick={() => void tap(() => setHidden(true))} className="shrink-0 rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-[#361210] shadow active:scale-95">Install</button>
          <button onClick={later} aria-label="Not now" className="shrink-0 rounded-lg p-1.5 text-amber-100/70 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      </div>
      {sheet}
    </>
  );
}

/** The big install panel for the public /install page: one button where the phone allows it, clear steps where it does not. */
export function InstallPanel({ address }: { address: string }) {
  const s = useInstall();
  const [result, setResult] = React.useState<string | null>(null);

  if (!s.ready) return <p className="text-center text-sm text-slate-500">One moment…</p>;

  if (s.installed) {
    return (
      <div className="rounded-xl bg-emerald-50 p-5 text-center ring-1 ring-emerald-200">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
        <p className="mt-2 font-semibold text-emerald-900">The DSC app is installed on this device.</p>
        <p className="mt-1 text-sm text-emerald-800">Open it from your home screen. It updates by itself, so you never install it again.</p>
      </div>
    );
  }

  if (s.inAppBrowser) {
    return (
      <div className="space-y-3 rounded-xl bg-amber-50 p-5 ring-1 ring-amber-200">
        <p className="flex items-center gap-2 font-semibold text-amber-900"><ExternalLink className="h-5 w-5" /> Open this page in your browser first</p>
        <p className="text-sm text-amber-900">You opened this link inside another app (such as WhatsApp), and apps cannot be installed from there.</p>
        <ol className="space-y-2">
          <Step n={1}>Tap the <MoreVertical className="mx-0.5 inline h-4 w-4" /> menu (or the <b>Share</b> button) at the top of this screen.</Step>
          <Step n={2}>Choose <b>Open in Chrome</b> (Android) or <b>Open in Safari</b> (iPhone).</Step>
          <Step n={3}>Or open <b>{address}</b> in Chrome or Safari yourself.</Step>
        </ol>
      </div>
    );
  }

  if (s.ios) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-700">On an iPhone or iPad the app is installed from <b>Safari</b> (not Chrome). It takes three taps:</p>
        <StepsList ios />
        <p className="text-xs text-slate-500">Apple does not allow a one-tap install button, so these taps are needed once.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {s.canPrompt ? (
        <>
          <button onClick={async () => setResult(await s.install())} className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-800 text-lg font-semibold text-white shadow-lg hover:bg-brand-900 active:scale-[0.99]">
            <Download className="h-6 w-6" /> Install the DSC app
          </button>
          {result === "dismissed" && <p className="text-center text-sm text-slate-500">No problem. Press the button when you are ready.</p>}
          <p className="text-center text-xs text-slate-500">It opens full screen like a normal app, with its own icon, and it updates by itself.</p>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-700">Install it from the browser menu. Use <b>Chrome</b>:</p>
          <StepsList ios={false} />
          <p className="text-xs text-slate-500">If you do not see <b>Install app</b>, the app may already be installed on this device. Look for the DSC icon, or reload this page once.</p>
        </>
      )}
    </div>
  );
}
