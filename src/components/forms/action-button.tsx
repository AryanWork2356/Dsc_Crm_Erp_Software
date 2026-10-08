"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

type Props = Omit<ButtonProps, "onClick"> & {
  action: () => Promise<ActionResult>;
  /** If set, shows a confirmation dialog first (use for delete / irreversible steps). */
  confirm?: { title: string; body?: string; confirmLabel?: string };
  successMessage?: string;
  onDone?: (r: Extract<ActionResult, { ok: true }>) => void;
};

/** Button that runs a server action with loading, confirm, toast + refresh. Never fails silently. */
export function ActionButton({ action, confirm, successMessage, onDone, children, variant, ...rest }: Props) {
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const toast = useToast();

  function go() {
    start(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(r.message ?? successMessage ?? "Done");
        setOpen(false);
        router.refresh();
        onDone?.(r);
      } else {
        toast.error(r.error);
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button {...rest} variant={variant} loading={pending && !confirm} onClick={() => (confirm ? setOpen(true) : go())}>
        {children}
      </Button>
      {confirm && (
        <Modal open={open} onOpenChange={setOpen} title={confirm.title} description={confirm.body}>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={variant === "danger" ? "danger" : "primary"} loading={pending} onClick={go}>
              {confirm.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
