"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { Info } from "lucide-react";
import { helpFor } from "@/lib/help";
import { Modal } from "@/components/ui/dialog";

/** The "i" at the top of every screen: what this screen is for, what you can do on it, and an example. */
export function HelpButton() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const h = helpFor(pathname);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-brand-700"
        aria-label="What is this screen for?"
        title="What is this screen for?"
      >
        <Info className="h-5 w-5" />
      </button>
      <Modal open={open} onOpenChange={setOpen} title={h.title} description="What this screen is for">
        <div className="space-y-4 text-sm text-slate-700">
          <p>{h.purpose}</p>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">What you can do here</p>
            <ul className="list-disc space-y-1 pl-5">
              {h.can.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Example</p>
            <p className="mt-0.5 text-slate-800">{h.example}</p>
          </div>
        </div>
      </Modal>
    </>
  );
}
