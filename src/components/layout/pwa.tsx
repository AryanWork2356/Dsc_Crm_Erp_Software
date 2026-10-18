"use client";
import * as React from "react";
import { Download, Share, X } from "lucide-react";

/** Registers the service worker (production only, so development is never confused by caching). */
export function PwaRegister() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * "Install the app" button. Android/Chrome shows the real install prompt; iPhone has no prompt, so it shows the
 * two taps (Share → Add to Home Screen). Hidden once the app is already installed.
 */
export function InstallApp() {
  const [evt, setEvt] = React.useState<InstallEvent | null>(null);
  const [installed, setInstalled] = React.useState(true); // assume installed until we know otherwise (avoids a flash)
  const [help, setHelp] = React.useState(false);
  const [ios, setIos] = React.useState(false);

  React.useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (installed || (!evt && !ios)) return null;

  async function click() {
    if (evt) { await evt.prompt(); await evt.userChoice.catch(() => null); setEvt(null); }
    else setHelp(true);
  }

  return (
    <>
      <button onClick={click} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100" title="Install the DSC app on this phone" aria-label="Install the DSC app">
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
