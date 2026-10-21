"use client";
import * as React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/** Shown instead of a blank screen when something on a page breaks. Keeps the menu, shows what happened, and lets the person retry. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
        <div>
          <h1 className="text-lg font-semibold">This screen hit a problem</h1>
          <p className="mt-1 text-sm">Your work on other screens is safe. Press <b>Try again</b>. If it keeps happening, turn off your browser&apos;s &quot;Translate this page&quot; for this site and reload, then tell us what you were doing.</p>
          <button onClick={reset} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"><RotateCw className="h-4 w-4" /> Try again</button>
          <details className="mt-4 text-xs text-amber-900/80">
            <summary className="cursor-pointer font-medium">Details to send us</summary>
            <p className="mt-2 break-words font-mono">{error.message || "(no message)"}{error.digest ? ` · ref ${error.digest}` : ""}</p>
          </details>
        </div>
      </div>
    </div>
  );
}
