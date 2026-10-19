import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page";
import { ImportClientBoq } from "./import-client-boq";

export const metadata = { title: "Import the client's BOQ" };

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requirePerm("boq:edit");
  const { id } = await params;
  const b = await db.boq.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { _count: { select: { items: true } } } });
  if (!b) notFound();
  if (b.status !== "DRAFT") redirect(`/sales/boq/${id}`);
  return (
    <div>
      <PageHeader back={{ href: `/sales/boq/${id}`, label: `${b.number} · ${b.title}` }} title="Import the client's BOQ" subtitle="Upload the Excel the client sent. DSC then adds its rates and makes the quotation." />
      <ImportClientBoq boqId={id} hasItems={b._count.items > 0} canKeepRates={c.can("quotations:view")} />
    </div>
  );
}
