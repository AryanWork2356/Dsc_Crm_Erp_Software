import Link from "next/link";
import type { Prisma, VendorBillStatus } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { PAYMENT_METHOD_OPTS } from "@/lib/enums";
import { projectOptions, vendorOptions } from "@/lib/lookups";
import { formatDate, formatINR, humanize, num, startOfDay, toDateInput, cn } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { cancelVendorBill, certifyVendorBill, createVendorBill, payVendorBill } from "../actions";

import { billReadingOn } from "@/lib/bill-reader";
import { Paperclip } from "lucide-react";
import { projectScope } from "@/lib/scope";

export const metadata = { title: "Vendor Bills" };
// reading a bill photo can take up to a minute
export const maxDuration = 60;

export default async function BillsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("vendor_bills:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "billDate", "desc", 25);
  const today = startOfDay();
  const where: Prisma.VendorBillWhereInput = {
    companyId: c.companyId,
    ...(sp.status ? { status: sp.status as VendorBillStatus } : {}),
    ...(sp.vendor ? { vendorId: sp.vendor } : {}),
    ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { vendor: { name: { contains: lp.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, vendors, projects, pos, unpaid] = await Promise.all([
    db.vendorBill.findMany({ where, include: { vendor: { select: { name: true } }, po: { select: { number: true } } }, orderBy: { billDate: "desc" }, skip: lp.skip, take: lp.take }),
    db.vendorBill.count({ where }),
    vendorOptions(c.companyId), projectOptions(c.companyId, projectScope(c)),
    db.purchaseOrder.findMany({ where: { companyId: c.companyId, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { id: true, number: true, vendor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.vendorBill.findMany({ where: { companyId: c.companyId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, select: { amount: true, paid: true, dueDate: true } }),
  ]);
  const files = rows.length ? await db.document.findMany({ where: { companyId: c.companyId, entityType: "VENDOR_BILL", entityId: { in: rows.map((r) => r.id) }, deletedAt: null }, select: { id: true, entityId: true } }) : [];
  const billOf = new Map(files.map((f) => [f.entityId!, f.id]));
  const owed = unpaid.reduce((s, b) => s + num(b.amount) - num(b.paid), 0);
  const late = unpaid.filter((b) => b.dueDate && b.dueDate < today).reduce((s, b) => s + num(b.amount) - num(b.paid), 0);

  return (
    <>
      <PageHeader title="Vendor bills" subtitle="Bills received from vendors and payments made against them." actions={c.can("vendor_bills:create") && (
        <FormDialog title="Record vendor bill" wide bill={{ kind: "vendor_bill", read: billReadingOn() }} trigger={<Button>Add bill</Button>} fields={[
          { name: "vendorId", label: "Vendor", type: "select", required: true, options: vendors },
          { name: "number", label: "Vendor's bill number", required: true },
          { name: "poId", label: "Against purchase order", type: "select", options: pos.map((p) => ({ value: p.id, label: `${p.number} · ${p.vendor.name}` })), hint: "Optional. Material bills should be linked to their PO" },
          { name: "projectId", label: "Project (for service / sub-contract bills)", type: "select", options: projects },
          { name: "billDate", label: "Bill date", type: "date", required: true, defaultValue: toDateInput(new Date()) },
          { name: "dueDate", label: "Due date", type: "date" },
          { name: "amount", label: "Bill amount incl. GST (₹)", type: "number", required: true },
          { name: "notes", label: "Notes", type: "textarea" },
          { name: "overrideReason", label: "Reason to go ahead (only if the app warns)", type: "textarea", full: true, hint: "If the bill looks like one already recorded, or is for material that has not arrived, say why it is right." },
        ]} action={createVendorBill} submitLabel="Save bill" />
      )} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3"><StatCard label="Unpaid" value={formatINR(owed)} tone={owed ? "warn" : "good"} href="/finance/payables" /><StatCard label="Overdue" value={formatINR(late)} tone={late ? "bad" : "good"} /></div>
      <Card>
        <ListFilters placeholder="Search bill number or vendor…" filters={[{ key: "status", label: "Status", options: ["UNPAID", "PARTIALLY_PAID", "PAID", "CANCELLED"].map((s) => ({ value: s, label: humanize(s) })) }, { key: "vendor", label: "Vendor", options: vendors }]} />
        {rows.length === 0 ? <EmptyState title="No bills found" /> : (
          <>
            <Table>
              <THead><tr><Th>Bill</Th><Th>Vendor</Th><Th>PO</Th><Th>Due</Th><Th right>Amount</Th><Th right>Balance</Th><Th>Status</Th><Th /></tr></THead>
              <tbody>
                {rows.map((b) => {
                  const bal = num(b.amount) - num(b.paid);
                  const overdue = b.dueDate && b.dueDate < today && bal > 0.005 && b.status !== "CANCELLED";
                  return (
                    <Tr key={b.id}>
                      <Td><p className="font-medium text-slate-900">{b.number}{billOf.has(b.id) && <a href={`/documents/${billOf.get(b.id)}/download?inline=1`} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline"><Paperclip className="h-3 w-3" />Bill</a>}</p><p className="text-xs text-slate-500">{formatDate(b.billDate)}</p></Td>
                      <Td>{b.vendor.name}</Td><Td>{b.po?.number ?? "—"}</Td>
                      <Td className={cn(overdue && "font-medium text-red-600")}>{formatDate(b.dueDate)}{overdue && <Badge tone="red" className="ml-1.5">Overdue</Badge>}</Td>
                      <Td right>{formatINR(b.amount)}</Td><Td right className={bal > 0.005 && b.status !== "CANCELLED" ? "font-semibold text-amber-700" : "text-slate-400"}>{b.status === "CANCELLED" ? "—" : formatINR(bal)}</Td>
                      <Td><div className="flex flex-wrap items-center gap-1"><StatusBadge status={b.status} />{b.status !== "CANCELLED" && b.certRequired && (b.certifiedAt ? <Badge tone="green">Certified</Badge> : <Badge tone="amber">Needs certification</Badge>)}</div></Td>
                      <Td right>
                        <div className="flex justify-end gap-1">
                          {c.can("bill_certification:approve") && b.certRequired && !b.certifiedAt && b.status !== "CANCELLED" && <FormDialog title={`Certify bill ${b.number}`} description="Confirm the supporting documents (challan, measurements, invoice) have been checked." trigger={<Button size="sm">Certify</Button>} fields={[{ name: "docsChecked", label: "I have checked the supporting documents", type: "checkbox", required: true, full: true }, { name: "note", label: "Note (optional)", type: "textarea", full: true }]} action={certifyVendorBill.bind(null, b.id)} submitLabel="Certify bill" />}
                          {c.can("vendor_bills:edit") && bal > 0.005 && b.status !== "CANCELLED" && (!b.certRequired || b.certifiedAt) && <FormDialog title={`Pay – bill ${b.number}`} description={`Balance: ${formatINR(bal, true)}`} trigger={<Button size="sm" variant="secondary">Pay</Button>} fields={[{ name: "billId", label: "Bill", type: "hidden", defaultValue: b.id }, { name: "amount", label: "Amount (₹)", type: "number", required: true, defaultValue: Math.round(bal * 100) / 100 }, { name: "date", label: "Payment date", type: "date", required: true, defaultValue: toDateInput(new Date()) }, { name: "method", label: "Method", type: "select", options: PAYMENT_METHOD_OPTS, defaultValue: "BANK_TRANSFER" }, { name: "reference", label: "Reference / UTR" }]} action={payVendorBill} submitLabel="Record payment" />}
                          {c.can("vendor_bills:delete") && num(b.paid) === 0 && b.status !== "CANCELLED" && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={cancelVendorBill.bind(null, b.id)} confirm={{ title: `Cancel bill ${b.number}?`, confirmLabel: "Cancel bill" }}>Cancel</ActionButton>}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/finance/bills" />
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">Vendors: <Link className="text-brand-700 hover:underline" href="/procurement/vendors">manage</Link></p>
    </>
  );
}
