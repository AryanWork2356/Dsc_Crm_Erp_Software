import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { remarkScope, isRemarkStaff } from "@/lib/remarks";
import { tradeLabel } from "@/lib/trades";
import { formatDateTime, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/forms/action-button";
import { RemarkReply } from "./reply";
import { setRemarkResolved } from "../actions";

export const metadata = { title: "Remark" };

export default async function RemarkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx();
  const r = await db.remark.findFirst({
    where: { id, ...remarkScope(c) },
    include: { project: { select: { id: true, code: true, name: true } }, vendor: { select: { name: true, contactPerson: true, phone: true } }, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!r) notFound();
  const people = new Map((await db.user.findMany({ where: { id: { in: [...new Set(r.messages.map((m) => m.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const staff = isRemarkStaff(c);
  const canReply = staff || r.createdById === c.userId;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: "/remarks", label: "Remarks" }}
        title={r.project ? `${r.project.code} · ${r.project.name}` : "Remark"}
        subtitle={r.trade ? `${tradeLabel(r.trade)}${r.vendor ? ` · ${r.vendor.name}` : ""}` : undefined}
        actions={<>
          <Badge tone={r.status === "OPEN" ? "amber" : "green"}>{r.status === "OPEN" ? "Open" : "Sorted"}</Badge>
          {canReply && <ActionButton size="sm" variant={r.status === "OPEN" ? "primary" : "secondary"} action={setRemarkResolved.bind(null, id, r.status === "OPEN")}>{r.status === "OPEN" ? "Mark sorted" : "Open again"}</ActionButton>}
        </>}
      />
      {r.vendor && (r.vendor.phone || r.vendor.contactPerson) && (
        <Card className="mb-4"><CardBody className="py-3 text-sm">Vendor: <b>{r.vendor.name}</b>{r.vendor.contactPerson ? ` · ${r.vendor.contactPerson}` : ""}{r.vendor.phone && <> · <a href={`tel:${r.vendor.phone}`} className="font-semibold text-brand-700">📞 {r.vendor.phone}</a></>}</CardBody></Card>
      )}
      <div className="space-y-3">
        {r.messages.map((m) => {
          const mine = m.userId === c.userId;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[88%] rounded-2xl px-4 py-2.5 sm:max-w-[75%]", mine ? "bg-brand-800 text-white" : "bg-white text-slate-900 ring-1 ring-slate-200")}>
                <p className={cn("text-xs font-semibold", mine ? "text-white/80" : "text-slate-500")}>{mine ? "You" : people.get(m.userId) ?? "Someone"}</p>
                <p className="whitespace-pre-wrap text-[15px]">{m.body}</p>
                <p className={cn("mt-1 text-[11px]", mine ? "text-white/70" : "text-slate-400")}>{formatDateTime(m.createdAt)}</p>
              </div>
            </div>
          );
        })}
      </div>
      {canReply ? <RemarkReply id={id} staff={staff} /> : <p className="mt-4 text-sm text-slate-500">Only the person who wrote this and the admins can reply.</p>}
    </div>
  );
}
