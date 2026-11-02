"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { replyRemark } from "../actions";

/** The reply box under a remark (with the mic and the spelling button of every notes box). */
export function RemarkReply({ id, staff }: { id: string; staff: boolean }) {
  const [text, setText] = React.useState("");
  const [pending, start] = React.useTransition();
  const router = useRouter();
  const toast = useToast();
  function send() {
    if (!text.trim()) return;
    start(async () => {
      const r = await replyRemark(id, text);
      if (r.ok) { setText(""); router.refresh(); } else toast.error(r.error);
    });
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); send(); }} className="sticky bottom-0 mt-4 flex items-end gap-2 bg-slate-50 py-2">
      <div className="min-w-0 flex-1">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="text-base"
          placeholder={staff ? "e.g. Spoke to the vendor, the painter is coming at 11 am" : "Add more, or reply to the admin"} />
      </div>
      <Button type="submit" loading={pending} disabled={!text.trim()} className="h-12" aria-label="Send"><Send className="h-5 w-5" /></Button>
    </form>
  );
}
