import Link from "next/link";
import type { Ctx } from "@/lib/auth";
import { clientAccount } from "@/lib/client-account";
import { db } from "@/lib/db";
import { formatDate, formatINR, num, toDateInput } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/ui/page";
import { createClientPO, setClientPoStatus, updateClientPO } from "../po-actions";

/** One company's orders and money in one place: what they ordered (POs), what we billed against each, what is received, what is left. */
export async function ClientOrders({ c, clientId }: { c: Ctx; clientId: string }) {
  const canRecord = c.can("invoices:create") || c.can("quotations:edit");
  const money = c.can("finance:view");
  const acc = await clientAccount(c.companyId, clientId);
  const [projects, quotes] = await Promise.all([
    db.project.findMany({ where: { companyId: c.companyId, clientId, deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" } }),
    db.quotation.findMany({ where: { companyId: c.companyId, clientId, deletedAt: null }, select: { id: true, number: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const docs = acc.pos.some((l) => l.po.documentId) ? await db.document.findMany({ where: { id: { in: acc.pos.map((l) => l.po.documentId).filter((x): x is string => !!x) } }, select: { id: true } }) : [];
  const hasDoc = new Set(docs.map((d) => d.id));

  const addFields = [
    { name: "clientId", label: "Client", type: "hidden" as const, defaultValue: clientId },
    { name: "number", label: "Client's PO number", required: true },
    { name: "poDate", label: "PO date", type: "date" as const },
    { name: "amount", label: "PO value (₹, without GST)", type: "number" as const, required: true },
    { name: "scopes", label: "What it covers", hint: "e.g. Civil and interiors, FAS, HVAC", full: true },
    { name: "projectId", label: "Project", type: "select" as const, options: projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })) },
    { name: "quotationId", label: "Our quotation", type: "select" as const, options: quotes.map((q) => ({ value: q.id, label: q.number })) },
    { name: "file", label: "PO file (PDF or photo)", type: "file" as const, full: true },
    { name: "note", label: "Note", type: "textarea" as const, full: true },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client purchase orders &amp; account</CardTitle>
        {canRecord && <FormDialog title="Record the client's PO" description="Keep the client's order here so billing and receivables stay tied to it." wide trigger={<Button size="sm">Add PO</Button>} fields={addFields} action={createClientPO} submitLabel="Save PO" />}
      </CardHeader>
      {money && acc.pos.length > 0 && (
        <CardBody className="grid grid-cols-2 gap-3 border-b border-slate-100 text-sm sm:grid-cols-5">
          <div><p className="text-xs text-slate-500">Ordered (PO)</p><p className="tabular font-semibold">{formatINR(acc.totals.poValue)}</p></div>
          <div><p className="text-xs text-slate-500">Billed</p><p className="tabular font-semibold">{formatINR(acc.totals.billed)}</p></div>
          <div><p className="text-xs text-slate-500">Received</p><p className="tabular font-semibold text-emerald-700">{formatINR(acc.totals.received)}</p></div>
          <div><p className="text-xs text-slate-500">Left to bill</p><p className="tabular font-semibold">{formatINR(acc.totals.leftToBill)}</p></div>
          <div><p className="text-xs text-slate-500">Left to collect</p><p className="tabular font-semibold text-amber-700">{formatINR(acc.totals.leftToCollect)}</p></div>
        </CardBody>
      )}
      {acc.pos.length === 0 ? (
        <EmptyState title="No purchase orders recorded" hint="When this client gives you a PO, add it here. Invoices can then be billed against it, and the balance stays visible." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {acc.pos.map((l) => (
            <li key={l.po.id} className="space-y-2 px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">PO {l.po.number}</span>
                {l.po.poDate && <span className="text-xs text-slate-500">{formatDate(l.po.poDate)}</span>}
                <StatusBadge status={l.po.status} />
                {l.po.documentId && hasDoc.has(l.po.documentId) && <a className="text-xs text-brand-700 hover:underline" href={`/documents/${l.po.documentId}/download`}>view PO file</a>}
                <span className="tabular ml-auto font-semibold">{formatINR(l.po.amount)}</span>
              </div>
              {l.po.scopes && <p className="text-xs text-slate-600">{l.po.scopes}</p>}
              {money && (
                <p className="tabular text-xs text-slate-600">
                  Billed {formatINR(l.billed)} · received {formatINR(l.received)} · left to bill <b className={l.leftToBill < -0.5 ? "text-red-600" : ""}>{formatINR(l.leftToBill)}</b> · left to collect <b className="text-amber-700">{formatINR(l.leftToCollect)}</b>
                </p>
              )}
              {l.invoices.length > 0 && (
                <p className="text-xs text-slate-500">
                  Invoices:{" "}
                  {l.invoices.map((i, n) => <span key={i.id}>{n > 0 && ", "}<Link className="text-brand-700 hover:underline" href={`/finance/invoices/${i.id}`}>{i.number}</Link></span>)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {c.can("invoices:create") && l.po.status === "OPEN" && <Link href={`/finance/invoices/new?clientId=${clientId}&poId=${l.po.id}`}><Button size="sm" variant="secondary">Bill against this PO</Button></Link>}
                {canRecord && l.po.status !== "CANCELLED" && (
                  <FormDialog title={`Change PO ${l.po.number}`} description="Use this when the client sends an amended PO." trigger={<Button size="sm" variant="ghost">Change</Button>}
                    fields={[{ name: "number", label: "PO number", required: true, defaultValue: l.po.number }, { name: "poDate", label: "PO date", type: "date", defaultValue: l.po.poDate ? toDateInput(l.po.poDate) : "" }, { name: "amount", label: "PO value (₹, without GST)", type: "number", required: true, defaultValue: num(l.po.amount) }, { name: "scopes", label: "What it covers", full: true, defaultValue: l.po.scopes }, { name: "note", label: "Note", type: "textarea", full: true, defaultValue: l.po.note }]}
                    action={updateClientPO.bind(null, l.po.id)} />
                )}
                {canRecord && l.po.status === "OPEN" && <ActionButton size="sm" variant="ghost" action={setClientPoStatus.bind(null, l.po.id, "CLOSED")} confirm={{ title: "Close this PO?", body: "Use this when everything on it has been delivered and billed. You can reopen it later.", confirmLabel: "Close PO" }}>Close</ActionButton>}
                {canRecord && l.po.status === "CLOSED" && <ActionButton size="sm" variant="ghost" action={setClientPoStatus.bind(null, l.po.id, "OPEN")}>Reopen</ActionButton>}
                {canRecord && l.po.status === "OPEN" && l.billed === 0 && l.committedBilling === 0 && (
                  <FormDialog title={`Cancel PO ${l.po.number}?`} trigger={<Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50">Cancel PO</Button>} fields={[{ name: "reason", label: "Why was it cancelled?", type: "textarea", required: true, full: true }]} action={setClientPoStatus.bind(null, l.po.id, "CANCELLED")} submitLabel="Cancel PO" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {money && acc.noPo.count > 0 && <CardBody className="border-t border-slate-100 text-xs text-slate-500">{acc.noPo.count} issued invoice{acc.noPo.count === 1 ? "" : "s"} not linked to any PO: billed {formatINR(acc.noPo.billed)}, received {formatINR(acc.noPo.received)}, left to collect {formatINR(acc.noPo.leftToCollect)}.</CardBody>}
    </Card>
  );
}
