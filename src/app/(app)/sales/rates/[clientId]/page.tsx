import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { RateCardEditor } from "./rate-card-editor";
import { saveRateCard } from "../../boq/rate-actions";

export const metadata = { title: "Client rates" };

export default async function ClientRatesPage({ params }: { params: Promise<{ clientId: string }> }) {
  const c = await requirePerm("boq:view");
  if (!c.can("margins:view")) redirect("/sales/boq");
  const { clientId } = await params;
  const client = await db.client.findFirst({ where: { id: clientId, companyId: c.companyId, deletedAt: null }, include: { rateCard: { include: { rates: { orderBy: [{ category: "asc" }, { name: "asc" }] } } } } });
  if (!client) notFound();
  const card = client.rateCard;
  return (
    <>
      <PageHeader back={{ href: "/sales/rates", label: "All client rates" }} title={`${client.name} – rates`} subtitle="Cost per unit (per sq ft, per rft …) and the profit DSC adds for this client." />
      <RateCardEditor
        editable={c.can("boq:edit")}
        profitPct={card ? num(card.profitPct) : 0}
        save={saveRateCard.bind(null, clientId)}
        initial={(card?.rates ?? []).map((r) => ({ name: r.name, unit: r.unit, category: r.category, materialRate: num(r.materialRate), labourRate: num(r.labourRate), otherRate: num(r.otherRate) }))}
      />
    </>
  );
}
