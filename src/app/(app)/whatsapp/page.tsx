import Link from "next/link";
import { AlertTriangle, Check, CheckCheck, StickyNote } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { isConnected, loadWaConfig, TEMPLATES } from "@/lib/whatsapp";
import { userOptions } from "@/lib/lookups";
import { formatDateTime, initials, cn } from "@/lib/utils";
import { PageHeader, Alert, EmptyState } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { FormDialog } from "@/components/forms/form-dialog";
import { assignConversation, markConversationRead, sendMessage, sendTemplate, startConversation } from "./actions";
import { Composer, MarkRead } from "./composer";

export const metadata = { title: "WhatsApp" };

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; show?: string }> }) {
  const c = await requirePerm("whatsapp:view");
  const sp = await searchParams;
  const mine = ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role) ? {} : { OR: [{ assignedToId: c.userId }, { assignedToId: null }] };
  const where = {
    companyId: c.companyId, ...mine,
    ...(sp.show === "unread" ? { unread: { gt: 0 } } : {}),
    ...(sp.q ? { OR: [{ contactName: { contains: sp.q, mode: "insensitive" as const } }, { phone: { contains: sp.q.replace(/\D/g, "") || "~~" } }] } : {}),
  };
  const [convs, cfg, staff] = await Promise.all([
    db.whatsAppConversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 100, include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } } }),
    loadWaConfig(c.companyId),
    userOptions(c.companyId),
  ]);
  const selected = sp.c ? await db.whatsAppConversation.findFirst({ where: { id: sp.c, companyId: c.companyId, ...mine } }) : null;
  const [messages, lead, client] = selected
    ? await Promise.all([db.whatsAppMessage.findMany({ where: { conversationId: selected.id }, orderBy: { createdAt: "asc" }, take: 300 }), selected.leadId ? db.lead.findUnique({ where: { id: selected.leadId }, select: { id: true, name: true } }) : null, selected.clientId ? db.client.findUnique({ where: { id: selected.clientId }, select: { id: true, name: true } }) : null])
    : [[], null, null];
  const connected = isConnected(cfg);
  const totalUnread = convs.reduce((s, x) => s + x.unread, 0);
  const sender = new Map(staff.map((s) => [s.value, s.label]));
  const canSend = c.can("whatsapp:create");

  return (
    <>
      <PageHeader title="WhatsApp" subtitle={totalUnread ? `${totalUnread} unread` : "Customer conversations in one inbox."} actions={<>
        {c.can("settings:manage") && <Link href="/settings/whatsapp"><Button variant="secondary" size="sm">Connection settings</Button></Link>}
        {canSend && <FormDialog title="New conversation" trigger={<Button size="sm">New chat</Button>} fields={[{ name: "phone", label: "WhatsApp number", type: "tel", required: true, placeholder: "98200 12345" }, { name: "name", label: "Name" }]} action={startConversation} submitLabel="Start" />}
      </>} />
      {!connected && <div className="mb-4"><Alert tone="warn">WhatsApp isn&apos;t connected to Meta yet, so messages are saved but <b>not delivered</b>. {c.can("settings:manage") ? <Link href="/settings/whatsapp" className="font-medium underline">Add the Cloud API details</Link> : "Ask the Owner or Admin to connect it."}</Alert></div>}

      <div className="grid h-[calc(100vh-17rem)] min-h-[480px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[320px_1fr]">
        <aside className={cn("flex min-h-0 flex-col border-r border-slate-200", selected && "hidden lg:flex")}>
          <form className="flex gap-2 border-b border-slate-100 p-3"><input name="q" defaultValue={sp.q} placeholder="Search chats…" className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm" aria-label="Search chats" />{sp.show === "unread" && <input type="hidden" name="show" value="unread" />}<Link href={sp.show === "unread" ? "/whatsapp" : "/whatsapp?show=unread"} className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-2.5 text-xs font-medium">{sp.show === "unread" ? "All" : "Unread"}</Link></form>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {convs.length === 0 && <li><EmptyState title="No chats" hint="Start one with “New chat”." /></li>}
            {convs.map((x) => (
              <li key={x.id}>
                <Link href={`/whatsapp?c=${x.id}`} className={cn("flex items-center gap-3 border-b border-slate-50 px-3 py-3 hover:bg-slate-50", selected?.id === x.id && "bg-brand-50")}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">{initials(x.contactName)}</span>
                  <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-slate-900">{x.contactName}</span><span className="shrink-0 text-[11px] text-slate-400">{formatDateTime(x.lastMessageAt)}</span></span>
                    <span className="flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-500">{x.messages[0]?.body ?? "No messages yet"}</span>{x.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white">{x.unread}</span>}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <section className={cn("flex min-h-0 flex-col bg-slate-50/60", !selected && "hidden lg:flex")}>
          {!selected ? <div className="m-auto text-center text-sm text-slate-500">Select a chat to read and reply.</div> : (
            <>
              <MarkRead id={selected.id} unread={selected.unread} action={markConversationRead.bind(null, selected.id)} />
              <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
                <Link href="/whatsapp" className="text-sm text-brand-700 lg:hidden">← Chats</Link>
                <div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-900">{selected.contactName}</p><p className="text-xs text-slate-500">+{selected.phone}{lead && <> · <Link className="text-brand-700 hover:underline" href={`/crm/leads/${lead.id}`}>Lead: {lead.name}</Link></>}{client && <> · <Link className="text-brand-700 hover:underline" href={`/crm/clients/${client.id}`}>Client: {client.name}</Link></>}</p></div>
                {c.can("whatsapp:edit") && (
                  <form action={async (fd) => { "use server"; await assignConversation(selected.id, String(fd.get("userId") ?? "") || null); }} className="flex items-center gap-1.5">
                    <Select name="userId" defaultValue={selected.assignedToId ?? ""} className="h-9 w-40 text-xs" aria-label="Assign conversation"><option value="">Unassigned</option>{staff.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
                    <Button size="sm" variant="secondary" type="submit">Assign</Button>
                  </form>
                )}
                {canSend && (
                  <FormDialog title="Send a template" description="Ready-made messages in DSC's wording." trigger={<Button size="sm" variant="secondary">Template</Button>} fields={[
                    { name: "template", label: "Message", type: "select", required: true, options: Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label })) },
                    { name: "number", label: "Quotation / invoice / ticket no.", hint: "Used by quotation, payment and support messages" }, { name: "amount", label: "Amount (₹)" }, { name: "date", label: "Date", placeholder: "e.g. 12 Nov" }, { name: "update", label: "Update text", type: "textarea" },
                  ]} action={sendTemplate.bind(null, selected.id)} submitLabel="Send" />
                )}
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {messages.length === 0 && <p className="py-10 text-center text-sm text-slate-400">No messages yet.</p>}
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "INBOUND" ? "justify-start" : "justify-end")}>
                    <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm", m.direction === "INBOUND" ? "rounded-bl-sm bg-white text-slate-900" : m.direction === "NOTE" ? "border border-amber-200 bg-amber-50 text-amber-950" : m.status === "FAILED" ? "rounded-br-sm border border-red-200 bg-red-50 text-red-900" : "rounded-br-sm bg-brand-800 text-white")}>
                      {m.direction === "NOTE" && <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700"><StickyNote className="h-3 w-3" /> Internal note</p>}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className={cn("mt-1 flex items-center justify-end gap-1 text-[11px]", m.direction === "OUTBOUND" && m.status !== "FAILED" ? "text-white/70" : "text-slate-400")}>
                        {m.sentById && sender.get(m.sentById) ? `${sender.get(m.sentById)} · ` : ""}{formatDateTime(m.createdAt)}
                        {m.direction === "OUTBOUND" && (m.status === "FAILED" ? <span className="flex items-center gap-0.5 font-medium text-red-600"><AlertTriangle className="h-3 w-3" /> Not delivered</span> : m.status === "READ" || m.status === "DELIVERED" ? <CheckCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {canSend ? <Composer send={sendMessage.bind(null, selected.id)} /> : <p className="border-t border-slate-200 bg-white p-3 text-center text-xs text-slate-500">You can read this chat but not reply.</p>}
            </>
          )}
        </section>
      </div>
    </>
  );
}
