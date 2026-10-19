import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, num } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Client rates" };

export default async function RatesPage() {
  const c = await requirePerm("boq:view");
  if (!c.can("margins:view")) redirect("/sales/boq");
  const clients = await db.client.findMany({
    where: { companyId: c.companyId, deletedAt: null },
    include: { rateCard: { include: { _count: { select: { rates: true } } } } },
    orderBy: { name: "asc" },
    take: 500,
  });
  return (
    <>
      <PageHeader title="Client rates" subtitle="DSC's cost per unit and the profit added for each client company. Used to fill and price a new BOQ in one click." />
      <Card>
        <Table>
          <THead><tr><Th>Client</Th><Th className="text-right">Saved rates</Th><Th className="text-right">Profit on cost</Th><Th>Last updated</Th><Th /></tr></THead>
          <tbody>
            {clients.map((cl) => (
              <Tr key={cl.id}>
                <Td className="font-medium text-slate-900">{cl.name}</Td>
                <Td className="text-right">{cl.rateCard ? cl.rateCard._count.rates : <Badge tone="slate">none yet</Badge>}</Td>
                <Td className="text-right">{cl.rateCard ? `${num(cl.rateCard.profitPct)}%` : "—"}</Td>
                <Td>{cl.rateCard ? `${formatDate(cl.rateCard.updatedAt)}${cl.rateCard.updatedBy ? ` · ${cl.rateCard.updatedBy}` : ""}` : "—"}</Td>
                <Td className="text-right"><Link className="font-medium text-brand-700 hover:underline" href={`/sales/rates/${cl.id}`}>{cl.rateCard ? "View / change" : "Set up"}</Link></Td>
              </Tr>
            ))}
            {clients.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">No clients yet. Add a client first.</td></tr>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
