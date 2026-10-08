"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea, Field } from "@/components/ui/form";
import type { ActionResult } from "@/lib/action";

export function StageSelect({
  current,
  options,
  action,
}: {
  current: string;
  options: { value: string; label: string }[];
  action: (stage: string, reason?: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [lost, setLost] = React.useState(false);
  const [reason, setReason] = React.useState("");

  function change(stage: string, why?: string) {
    start(async () => {
      const r = await action(stage, why);
      if (r.ok) toast.success(r.message ?? "Updated");
      else toast.error(r.error);
      router.refresh();
    });
  }

  return (
    <>
      <Select
        value={current}
        disabled={pending}
        aria-label="Change stage"
        className="w-auto min-w-[200px] font-medium"
        onChange={(e) => (e.target.value === "LOST" ? setLost(true) : change(e.target.value))}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
      <Modal open={lost} onOpenChange={setLost} title="Mark lead as lost" description="A reason helps us learn why deals are lost.">
        <div className="space-y-4">
          <Field label="Reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Budget too low, chose another firm…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setLost(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!reason.trim()}
              onClick={() => {
                setLost(false);
                change("LOST", reason);
                setReason("");
              }}
            >
              Mark lost
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
