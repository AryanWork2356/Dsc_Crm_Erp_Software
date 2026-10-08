"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action";
import { TASK_STATUS_OPTS } from "@/lib/enums";

/** Inline status + progress controls for a task row. */
export function TaskStatusControl({
  status,
  progress,
  disabled,
  action,
}: {
  status: string;
  progress: number;
  disabled?: boolean;
  action: (status: string, progress?: number) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [pct, setPct] = React.useState(progress);

  function go(s: string, p?: number) {
    start(async () => {
      const r = await action(s, p);
      if (!r.ok) {
        toast.error(r.error);
        setPct(progress);
      } else toast.success(r.message ?? "Updated");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={status} disabled={disabled || pending} onChange={(e) => go(e.target.value)} className="h-8 w-[130px] px-2 text-xs" aria-label="Task status">
        {TASK_STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      {status === "IN_PROGRESS" && (
        <Input
          type="number" min={0} max={100} value={pct} disabled={disabled || pending} aria-label="Progress percent"
          onChange={(e) => setPct(Number(e.target.value))}
          onBlur={() => pct !== progress && go("IN_PROGRESS", pct)}
          className="h-8 w-16 px-2 text-right text-xs"
        />
      )}
    </div>
  );
}
