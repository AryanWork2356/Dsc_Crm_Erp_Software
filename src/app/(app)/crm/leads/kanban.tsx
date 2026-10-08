"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, IndianRupee, User } from "lucide-react";
import { cn, formatINRCompact, formatDate, humanize } from "@/lib/utils";
import { Modal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea, Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";
import { StatusBadge } from "@/components/ui/badge";

export type KLead = {
  id: string;
  code: string;
  name: string;
  companyName: string | null;
  stage: string;
  value: number;
  priority: string;
  assignee: string | null;
  nextFollowUp: string | null;
  overdue: boolean;
};

const COLOR: Record<string, string> = {
  NEW: "border-t-blue-500", CONTACTED: "border-t-sky-500", QUALIFIED: "border-t-cyan-500",
  SITE_VISIT_SCHEDULED: "border-t-violet-400", SITE_VISIT_COMPLETED: "border-t-violet-600",
  PROPOSAL_IN_PROGRESS: "border-t-indigo-500", QUOTATION_SENT: "border-t-blue-700", NEGOTIATION: "border-t-amber-500",
  WON: "border-t-emerald-500", LOST: "border-t-red-500", ON_HOLD: "border-t-slate-400",
};

export function Kanban({
  stages,
  leads,
  canMove,
  move,
}: {
  stages: string[];
  leads: KLead[];
  canMove: boolean;
  move: (id: string, stage: string, reason?: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const [lostFor, setLostFor] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // optimistic local stage overrides until the server refresh lands
  const [local, setLocal] = React.useState<Record<string, string>>({});

  async function doMove(id: string, stage: string, why?: string) {
    setBusy(true);
    setLocal((l) => ({ ...l, [id]: stage }));
    const r = await move(id, stage, why);
    setBusy(false);
    if (r.ok) {
      toast.success(r.message ?? "Moved");
    } else {
      toast.error(r.error);
      setLocal((l) => {
        const { [id]: _drop, ...rest } = l;
        return rest;
      });
    }
    router.refresh();
    setLocal({});
  }

  function onDrop(stage: string) {
    const id = dragId;
    setDragId(null);
    setOver(null);
    if (!id || !canMove) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || (local[id] ?? lead.stage) === stage) return;
    if (stage === "LOST") {
      setLostFor(id);
      setReason("");
      return;
    }
    void doMove(id, stage);
  }

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-3">
          {stages.map((stage) => {
            const items = leads.filter((l) => (local[l.id] ?? l.stage) === stage);
            const total = items.reduce((s, l) => s + l.value, 0);
            return (
              <div
                key={stage}
                onDragOver={(e) => {
                  if (canMove) {
                    e.preventDefault();
                    setOver(stage);
                  }
                }}
                onDragLeave={() => setOver((o) => (o === stage ? null : o))}
                onDrop={() => onDrop(stage)}
                className={cn("flex w-64 shrink-0 flex-col rounded-xl border border-t-4 border-slate-200 bg-slate-100/70", COLOR[stage], over === stage && "ring-2 ring-brand-400")}
              >
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-sm font-semibold text-slate-800">{humanize(stage)}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">{items.length}</span>
                </div>
                {total > 0 && <p className="px-3 pb-2 text-xs text-slate-500">{formatINRCompact(total)}</p>}
                <div className="max-h-[65vh] min-h-24 space-y-2 overflow-y-auto px-2 pb-2">
                  {items.map((l) => (
                    <div
                      key={l.id}
                      draggable={canMove}
                      onDragStart={() => setDragId(l.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOver(null);
                      }}
                      className={cn("rounded-lg border border-slate-200 bg-white p-3 shadow-sm", canMove && "cursor-grab active:cursor-grabbing", dragId === l.id && "opacity-50")}
                    >
                      <Link href={`/crm/leads/${l.id}`} className="block text-sm font-medium text-slate-900 hover:text-brand-700">
                        {l.name}
                      </Link>
                      <p className="text-xs text-slate-500">{l.companyName ?? l.code}</p>
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        {l.value > 0 && (
                          <p className="flex items-center gap-1"><IndianRupee className="h-3 w-3" />{formatINRCompact(l.value).replace("₹", "")}</p>
                        )}
                        {l.assignee && <p className="flex items-center gap-1"><User className="h-3 w-3" />{l.assignee}</p>}
                        {l.nextFollowUp && (
                          <p className={cn("flex items-center gap-1", l.overdue && "font-medium text-red-600")}>
                            <CalendarClock className="h-3 w-3" />
                            {formatDate(l.nextFollowUp)}
                            {l.overdue && " · overdue"}
                          </p>
                        )}
                      </div>
                      {(l.priority === "HIGH" || l.priority === "URGENT") && (
                        <div className="mt-2"><StatusBadge status={l.priority} /></div>
                      )}
                    </div>
                  ))}
                  {items.length === 0 && <p className="px-1 py-6 text-center text-xs text-slate-400">Drop leads here</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {canMove && <p className="mt-1 text-xs text-slate-500">Tip: drag a card to another column to change its stage.</p>}

      <Modal open={!!lostFor} onOpenChange={(o) => !o && setLostFor(null)} title="Mark lead as lost" description="A reason helps us learn why deals are lost.">
        <div className="space-y-4">
          <Field label="Reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Budget too low, went with another firm…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setLostFor(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={!reason.trim()}
              onClick={async () => {
                const id = lostFor!;
                setLostFor(null);
                await doMove(id, "LOST", reason);
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
