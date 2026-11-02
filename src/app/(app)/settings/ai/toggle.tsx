"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { setAiEnabled } from "./actions";

/** The big ON / OFF button. Asks once before switching OFF, because every AI box and button disappears for everyone. */
export function AiToggle({ on, hasKey }: { on: boolean; hasKey: boolean }) {
  const [pending, start] = React.useTransition();
  const [confirm, setConfirm] = React.useState(false);
  const router = useRouter();
  const toast = useToast();

  function flip(next: boolean) {
    start(async () => {
      const r = await setAiEnabled(next);
      setConfirm(false);
      if (r.ok) { toast.success(r.message ?? "Saved"); router.refresh(); } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className={cn("flex items-center gap-4 rounded-2xl border-2 p-5", on ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-slate-50")}>
        <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white", on ? "bg-emerald-600" : "bg-slate-500")}><Power className="h-7 w-7" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold text-slate-900">AI helper is {on ? "ON" : "OFF"}</p>
          <p className="text-sm text-slate-600">{on ? (hasKey ? "Every AI feature is available to the people who use it." : "Switched on, but no AI key is set yet, so nothing shows.") : "Every AI box, button and menu entry is hidden. The app looks exactly as it did before AI."}</p>
        </div>
      </div>
      {!on && <Button onClick={() => flip(true)} loading={pending} className="h-12 w-full text-base">Switch the AI helper ON</Button>}
      {on && !confirm && <Button variant="secondary" onClick={() => setConfirm(true)} className="h-12 w-full text-base">Switch the AI helper OFF…</Button>}
      {on && confirm && (
        <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">Switch OFF for everyone? Reading bills, Ask the app, the spoken request box, spelling fix, English for notes and the evening summary will all disappear straight away. Nothing already saved is lost.</p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => flip(false)} loading={pending} className="flex-1">Yes, switch OFF</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Keep ON</Button>
          </div>
        </div>
      )}
    </div>
  );
}
