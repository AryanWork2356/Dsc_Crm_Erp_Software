/**
 * Shown the instant a menu item is tapped, while the next page loads, so the app never looks frozen.
 * (Next.js swaps it for the real page when it is ready.)
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <div className="fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-brand-100">
        <div className="h-full w-1/3 animate-[loadbar_1.1s_ease-in-out_infinite] rounded-full bg-brand-600" />
      </div>
      <div className="mb-6 space-y-2">
        <div className="h-7 w-56 animate-pulse rounded-md bg-slate-200" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-slate-100" />
      </div>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
      </div>
      <p className="mt-6 text-center text-sm text-slate-500">Loading…</p>
    </div>
  );
}
