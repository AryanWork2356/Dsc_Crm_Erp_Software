"use client";
import * as React from "react";
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
  installed: boolean; // already running as an installed app
  ios: boolean;
  inAppBrowser: boolean; // WhatsApp, Instagram, Facebook … cannot install apps: the link must be opened in Chrome or Safari
  canPrompt: boolean; // Chrome can show its real "Install app" window right now
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
};

/** What this phone or computer can do about installing the app. */
export function useInstall(): InstallState {
  const [, bump] = React.useState(0);
  const [env, setEnv] = React.useState({ ready: false, standalone: false, ios: false, inApp: false });

  React.useEffect(() => {
    const ua = navigator.userAgent;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setEnv({
      ready: true,
      standalone,
      ios: /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1), // iPads say they are Macs
      inApp: /FBAN|FBAV|Instagram|WhatsApp|Line\/|Telegram|; wv\)|Snapchat|LinkedInApp/i.test(ua),
    });
    const on = () => bump((n) => n + 1);
    window.addEventListener(READY, on);
    return () => window.removeEventListener(READY, on);
  }, []);

  const install = React.useCallback(async () => {
    const e = deferred;
    if (!e) return "unavailable" as const;
    await e.prompt();
    const r = await e.userChoice.catch(() => ({ outcome: "dismissed" }));
    deferred = null;
    bump((n) => n + 1);
    return r.outcome === "accepted" ? ("accepted" as const) : ("dismissed" as const);
  }, []);

  return { ready: env.ready, installed: env.standalone || installedNow, ios: env.ios, inAppBrowser: env.inApp, canPrompt: !!deferred, install };
}

/**
 * Small "Install app" button for the top bar. Chrome shows its real install window; an iPhone has no such window,
 * so it shows the two taps (Share → Add to Home Screen). Hidden once the app is installed.
 */
export function InstallApp() {
  const s = useInstall();
  const [help, setHelp] = React.useState(false);
  if (!s.ready || s.installed || (!s.canPrompt && !s.ios)) return null;
  return (
    <>
      <button onClick={() => (s.canPrompt ? void s.install() : setHelp(true))} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100" title="Install the DSC app on this phone" aria-label="Install the DSC app">
        <Download className="h-4 w-4" /> <span className="hidden sm:inline">Install app</span>
      </button>
      {help && (
        <div role="dialog" aria-label="Install on iPhone" className="fixed inset-x-4 bottom-4 z-50 rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200 sm:left-auto sm:right-6 sm:max-w-sm">
          <button onClick={() => setHelp(false)} className="absolute right-3 top-3 rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
          <p className="font-semibold text-slate-900">Put DSC on your home screen</p>
          <ol className="mt-2 space-y-2 text-sm text-slate-700">
            <li>1. Tap the <Share className="mx-1 inline h-4 w-4" /> <b>Share</b> button in Safari.</li>
            <li>2. Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          </ol>
        </div>
      )}
    </>
  );
}

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-800 text-xs font-bold text-white">{n}</span><span className="text-sm leading-relaxed text-slate-700">{children}</span></li>
);

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
        <ol className="space-y-3">
          <Step n={1}>Tap the <Share className="mx-1 inline h-4 w-4" /> <b>Share</b> button at the bottom of Safari.</Step>
          <Step n={2}>Scroll down and tap <b>Add to Home Screen</b>.</Step>
          <Step n={3}>Tap <b>Add</b>. The DSC icon appears on your home screen.</Step>
        </ol>
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
          <ol className="space-y-3">
            <Step n={1}>Tap the <MoreVertical className="mx-0.5 inline h-4 w-4" /> menu at the top right of Chrome.</Step>
            <Step n={2}>Choose <b>Install app</b>. <span className="text-slate-500">(Not &ldquo;Add to Home screen&rdquo;: that only makes a shortcut to the website.)</span></Step>
            <Step n={3}>Tap <b>Install</b>. The DSC icon appears with your other apps.</Step>
          </ol>
          <p className="text-xs text-slate-500">If you do not see <b>Install app</b>, the app may already be installed on this device. Look for the DSC icon, or reload this page once.</p>
        </>
      )}
    </div>
  );
}
