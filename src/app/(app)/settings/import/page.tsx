import { requireCtx } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ENTITIES } from "@/lib/importer";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody } from "@/components/ui/card";
import { importFile } from "./actions";
import { ImportPanel } from "./import-panel";

export const metadata = { title: "Import data" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const c = await requireCtx();
  const allowed = ENTITIES.filter((e) => c.can(e.perm));
  if (allowed.length === 0) redirect("/forbidden");
  const { entity } = await searchParams;
  return (
    <>
      <PageHeader title="Import data" subtitle="Bring in your existing lists from Excel or CSV – clients, leads, vendors, materials, workers and employees. BOQ items are imported inside each BOQ." />
      <Card><CardBody>
        <ImportPanel entities={allowed.map((e) => ({ key: e.key, label: e.label, columns: e.columns.map((x) => ({ header: x.header, required: x.required, hint: x.hint })) }))} action={importFile} initial={entity} />
      </CardBody></Card>
    </>
  );
}
