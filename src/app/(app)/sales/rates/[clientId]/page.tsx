import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { num } from "@/lib/utils";
import { sellFromCost } from "@/lib/rate-card";
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
      <PageHeader back={{ href: "/sales/rates", label: "All client rates" }} title={`${client.name} – rates`} subtitle="The rate DSC quotes this client for each item (per sq ft, per rft …), profit already in it. Used only when you press Use saved rates on this client's BOQ." />
      <RateCardEditor
        editable={c.can("boq:edit")}
        save={saveRateCard.bind(null, clientId)}
        initial={(card?.rates ?? []).map((r) => ({ name: r.name, unit: r.unit, category: r.category, rate: num(r.rate) > 0 ? num(r.rate) : sellFromCost(num(r.materialRate) + num(r.labourRate) + num(r.otherRate), num(card!.profitPct)) }))}
      />
    </>
  );
}
