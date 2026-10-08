"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";

export function Composer({ send }: { send: (fd: FormData) => Promise<ActionResult> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [note, setNote] = React.useState(false);
  const ref = React.useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (note) fd.set("note", "on");
    start(async () => {
      const r = await send(fd);
      if (r.ok) { toast.success(r.message ?? "Sent"); ref.current?.reset(); }
      else toast.error(r.error);
      router.refresh(); // failed messages are still recorded, so refresh either way
    });
  }

  return (
    <form ref={ref} onSubmit={submit} className={`border-t p-3 ${note ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-end gap-2">
        <Textarea name="body" rows={2} required placeholder={note ? "Internal note – only your team sees this" : "Type a message"} className="min-h-[44px] flex-1 resize-none" aria-label="Message" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) ref.current?.requestSubmit(); }} />
        <Button type="submit" loading={pending} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} className="accent-[#213f72]" /> Internal note (not sent to the customer) · Ctrl+Enter to send</label>
    </form>
  );
}

export function MarkRead({ id, unread, action }: { id: string; unread: number; action: () => Promise<ActionResult> }) {
  const router = useRouter();
  React.useEffect(() => {
    if (unread > 0) void action().then(() => router.refresh());
  }, [id, unread]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
