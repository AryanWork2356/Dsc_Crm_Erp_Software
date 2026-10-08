import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { CompanyForm } from "./company-form";

export const metadata = { title: "Company Settings" };

export default async function CompanySettingsPage() {
  const c = await requirePerm("settings:view");
  const s = await db.companySettings.findUnique({ where: { companyId: c.companyId } });
  return (
    <>
      <PageHeader title="Company Settings" subtitle="Used on quotations, purchase orders and invoices." />
      <Card>
        <CardBody>
          <CompanyForm
            canEdit={c.can("settings:manage")}
            values={{
              legalName: s?.legalName ?? "", address: s?.address ?? "", phone: s?.phone ?? "", email: s?.email ?? "",
              website: s?.website ?? "", gstin: s?.gstin ?? "", pan: s?.pan ?? "", bankName: s?.bankName ?? "",
              bankAccountNo: s?.bankAccountNo ?? "", bankIfsc: s?.bankIfsc ?? "", bankBranch: s?.bankBranch ?? "",
              invoicePrefix: s?.invoicePrefix ?? "INV", quotationPrefix: s?.quotationPrefix ?? "QT", poPrefix: s?.poPrefix ?? "PO",
              defaultTaxPercent: Number(s?.defaultTaxPercent ?? 18), approvalLevel1: Number(s?.approvalLevel1 ?? 25000),
              approvalLevel2: Number(s?.approvalLevel2 ?? 100000),
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
