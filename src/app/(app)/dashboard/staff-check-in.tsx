"use client";
import * as React from "react";
import { Select } from "@/components/ui/form";
import { CheckInButton } from "@/app/(worker)/worker/check-in-button";
import type { ActionResult } from "@/lib/action";

/** "I am at the office / at this site" – the phone's location must match the place chosen. */
export function StaffCheckIn({ places, action }: { places: { value: string; label: string }[]; action: (target: string, lat?: number, lng?: number, accuracy?: number, at?: number) => Promise<ActionResult> }) {
  const [target, setTarget] = React.useState(places[0]?.value ?? "office");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="min-w-48 flex-1 text-sm font-medium text-slate-700">
        I am at
        <Select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1">
          {places.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
      </label>
      <CheckInButton compact label="Mark attendance" action={(lat, lng, acc, at) => action(target, lat, lng, acc, at)} />
    </div>
  );
}
