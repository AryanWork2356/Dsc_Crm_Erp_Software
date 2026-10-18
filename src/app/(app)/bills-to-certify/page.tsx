import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { certifyVendorBill } from "../finance/actions";
import { formatDate, formatINR, formatDateTime } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";

export const metadata = { title: "Bills to certify" };
const WIDE = ["OWNER", "MANAGEMENT", "ADMIN"];

export default async function BillsToCertifyPage() {
  const c = await requirePerm("bill_certification:view");
  const wide = WIDE.includes(c.role);
  const mine = wide ? [] : (await db.project.findMany({ where: { companyId: c.companyId, projectManagerId: c.userId, deletedAt: null }, select: { id: true } })).map((p) => p.id);
  const bills = await db.vendorBill.findMany({
    where: { companyId: c.companyId, certRequired: true, certifiedAt: null, status: { not: "CANCELLED" }, ...(wide ? {} : { projectId: { in: mine } }) },
    include: { vendor: { select: { name: true } }, po: { select: { number: true } } },
    orderBy: { createdAt: "asc" },
  });
  const projects = await db.project.findMany({ where: { id: { in: [...new Set(bills.map((b) => b.projectId).filter(Boolean) as string[])] } }, select: { id: true, code: true, name: true } });
  const pj = new Map(projects.map((p) => [p.id, p]));

  return (
    <div>
      <PageHeader title="Bills to certify" subtitle="A vendor bill can be paid only after you have checked the supporting documents and certified it." />
      {bills.length === 0 ? (
        <EmptyState title="Nothing waiting for you" hint="Bills for your projects appear here when Accounts records them." />
      ) : (
        <div className="space-y-3">
          {bills.map((b) => {
            const p = b.projectId ? pj.get(b.projectId) : null;
            const waitingDays = Math.floor((Date.now() - b.createdAt.getTime()) / 86400000);
            return (
              <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{b.vendor.name} · bill {b.number} {waitingDays >= 2 && <Badge tone="red" className="ml-1">{waitingDays} days waiting</Badge>}</p>
                  <p className="mt-0.5 text-sm text-slate-600">{formatINR(b.amount)} · bill date {formatDate(b.billDate)}{b.po ? ` · against ${b.po.number}` : ""}</p>
                  <p className="text-xs text-slate-500">{p ? <>Project <Link className="text-brand-700 hover:underline" href={`/projects/${p.id}`}>{p.code} – {p.name}</Link></> : "No project – Management certifies"} · recorded {formatDateTime(b.createdAt)}</p>
                  {b.notes && <p className="mt-1 text-xs text-slate-500">{b.notes}</p>}
                </div>
                <FormDialog title={`Certify bill ${b.number}`} description="Confirm the supporting documents (challan, measurements, invoice) have been checked."
                  trigger={<Button>Certify</Button>}
                  fields={[{ name: "docsChecked", label: "I have checked the supporting documents", type: "checkbox", required: true, full: true }, { name: "note", label: "Note (optional)", type: "textarea", full: true }]}
                  action={certifyVendorBill.bind(null, b.id)} submitLabel="Certify bill" />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
