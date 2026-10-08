"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action";

type Person = { id: string; name: string; sub: string; status: string; ot: number };
const STATUSES = [
  { v: "PRESENT", label: "Present", on: "bg-emerald-600 text-white border-emerald-600" },
  { v: "HALF_DAY", label: "Half day", on: "bg-amber-500 text-white border-amber-500" },
  { v: "ABSENT", label: "Absent", on: "bg-red-600 text-white border-red-600" },
  { v: "LEAVE", label: "Leave", on: "bg-violet-600 text-white border-violet-600" },
] as const;

/** Tap-to-mark attendance grid. Used for site workers (per project) and for staff. */
export function AttendanceSheet({ people, date, projectId, idField, action, readOnly }: {
  people: Person[]; date: string; projectId?: string; idField: "workerId" | "employeeId"; readOnly?: boolean;
  action: (fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [rows, setRows] = React.useState(() => Object.fromEntries(people.map((p) => [p.id, { status: p.status === "OVERTIME" ? "PRESENT" : p.status, ot: p.ot }])));
  const [dirty, setDirty] = React.useState(false);
  const set = (id: string, patch: Partial<{ status: string; ot: number }>) => { setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } })); setDirty(true); };
  const markAll = (status: string) => { setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, status }]))); setDirty(true); };
  const counts = Object.values(rows).reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});

  function save() {
    const entries = people.filter((p) => rows[p.id].status).map((p) => ({ [idField]: p.id, status: rows[p.id].status, overtimeHrs: rows[p.id].ot || 0 }));
    const fd = new FormData();
    fd.set("date", date);
    if (projectId) fd.set("projectId", projectId);
    fd.set("entries", JSON.stringify(entries));
    start(async () => {
      const r = await action(fd);
      if (r.ok) { toast.success(r.message ?? "Saved"); setDirty(false); router.refresh(); } else toast.error(r.error);
    });
  }

  if (!people.length) return <p className="px-5 py-10 text-center text-sm text-slate-500">Nobody to mark here.</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3 text-sm">
        <span className="text-emerald-700">{counts.PRESENT ?? 0} present</span><span className="text-amber-600">{counts.HALF_DAY ?? 0} half</span><span className="text-red-600">{counts.ABSENT ?? 0} absent</span><span className="text-violet-600">{counts.LEAVE ?? 0} leave</span>
        <span className="text-slate-400">{Object.values(rows).filter((r) => !r.status).length} not marked</span>
        {!readOnly && <button className="ml-auto text-sm font-medium text-brand-700 hover:underline" onClick={() => markAll("PRESENT")}>Mark everyone present</button>}
      </div>
      <ul className="divide-y divide-slate-100">
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1 basis-40"><p className="font-medium text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{p.sub}</p></div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Attendance for ${p.name}`}>
              {STATUSES.map((s) => (
                <button key={s.v} disabled={readOnly} onClick={() => set(p.id, { status: s.v })} aria-pressed={rows[p.id].status === s.v}
                  className={cn("min-h-9 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-60", rows[p.id].status === s.v ? s.on : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")}>{s.label}</button>
              ))}
            </div>
            <div className="flex w-24 items-center gap-1.5 text-xs text-slate-500" title="Overtime hours">
              OT <Input type="number" min={0} max={12} step="0.5" disabled={readOnly || rows[p.id].status === "ABSENT" || rows[p.id].status === "LEAVE"} value={rows[p.id].ot || ""} onChange={(e) => set(p.id, { ot: Number(e.target.value) })} className="h-9 px-2 text-right" aria-label={`Overtime hours for ${p.name}`} />
            </div>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white px-5 py-3">
          {dirty && <span className="self-center text-xs font-medium text-amber-600">Unsaved changes</span>}
          <Button onClick={save} loading={pending} disabled={!dirty}>Save attendance</Button>
        </div>
      )}
    </div>
  );
}
