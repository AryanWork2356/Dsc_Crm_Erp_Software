import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { LEAD_SOURCE_OPTS } from "@/lib/enums";
import { formatDate, formatINR, num, toDateInput } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormDialog, type FieldDef } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { Donut, HBars } from "@/components/ui/charts";
import { createCampaign, deleteCampaign, updateCampaign } from "./actions";

export const metadata = { title: "Marketing" };

export default async function MarketingPage() {
  const c = await requirePerm("marketing:view");
  const [campaigns, leads] = await Promise.all([
    db.marketingCampaign.findMany({ where: { companyId: c.companyId }, orderBy: { createdAt: "desc" } }),
    db.lead.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { source: true, stage: true, estimatedValue: true } }),
  ]);
  const sources = LEAD_SOURCE_OPTS.map((o) => {
    const mine = leads.filter((l) => l.source === o.value);
    const won = mine.filter((l) => l.stage === "WON");
    const spend = campaigns.filter((x) => x.channel === o.value).reduce((s, x) => s + num(x.spend), 0);
    return { name: o.label, leads: mine.length, won: won.length, wonValue: won.reduce((s, l) => s + num(l.estimatedValue), 0), pipeline: mine.filter((l) => !["WON", "LOST"].includes(l.stage)).reduce((s, l) => s + num(l.estimatedValue), 0), spend, cpl: mine.length && spend ? spend / mine.length : 0, conv: mine.length ? (won.length / mine.length) * 100 : 0 };
  }).filter((s) => s.leads > 0 || s.spend > 0).sort((a, b) => b.leads - a.leads);
  const totalSpend = campaigns.reduce((s, x) => s + num(x.spend), 0);
  const wonCount = leads.filter((l) => l.stage === "WON").length;
  const fields = (x?: (typeof campaigns)[number]): FieldDef[] => [
    { name: "name", label: "Campaign", required: true, full: true, placeholder: "e.g. Diwali home-makeover reels", defaultValue: x?.name ?? null },
    { name: "channel", label: "Channel", type: "select", required: true, options: LEAD_SOURCE_OPTS, defaultValue: x?.channel ?? null, hint: "Matches the lead source so results line up" },
    { name: "spend", label: "Budget / spend (₹)", type: "number", defaultValue: x ? num(x.spend) : 0 },
    { name: "startDate", label: "Starts", type: "date", defaultValue: toDateInput(x?.startDate) }, { name: "endDate", label: "Ends", type: "date", defaultValue: toDateInput(x?.endDate) },
    { name: "notes", label: "Notes / content plan", type: "textarea", defaultValue: x?.notes ?? null },
  ];
  return (
    <>
      <PageHeader title="Marketing" subtitle="Which channels bring enquiries – and which ones turn into projects." actions={c.can("marketing:create") && <FormDialog title="New campaign" wide trigger={<Button>Add campaign</Button>} fields={fields()} action={createCampaign} successMessage="Campaign added" />} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Leads (all time)" value={leads.length} /><StatCard label="Won" value={wonCount} tone="good" sub={leads.length ? `${((wonCount / leads.length) * 100).toFixed(0)}% conversion` : undefined} />
        <StatCard label="Campaign spend" value={formatINR(totalSpend)} /><StatCard label="Cost per lead" value={leads.length && totalSpend ? formatINR(totalSpend / leads.length) : "—"} />
      </div>
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Leads by source</CardTitle></CardHeader><CardBody><Donut data={sources.map((s) => ({ name: s.name, value: s.leads }))} /></CardBody></Card>
        <Card><CardHeader><CardTitle>Won value by source</CardTitle></CardHeader><CardBody><HBars money data={sources.filter((s) => s.wonValue > 0).map((s) => ({ name: s.name, value: s.wonValue }))} /></CardBody></Card>
      </div>
      <Card className="mb-5">
        <CardHeader><CardTitle>Channel performance</CardTitle></CardHeader>
        {sources.length === 0 ? <EmptyState title="No data yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Channel</th><th className="px-3 py-2 text-right">Leads</th><th className="px-3 py-2 text-right">Won</th><th className="px-3 py-2 text-right">Conversion</th><th className="px-3 py-2 text-right">Open pipeline</th><th className="px-3 py-2 text-right">Spend</th><th className="px-3 py-2 text-right">Cost / lead</th></tr></thead>
            <tbody>{sources.map((s) => <tr key={s.name} className="border-t border-slate-100"><td className="px-4 py-2.5 font-medium text-slate-900">{s.name}</td><td className="tabular px-3 py-2.5 text-right">{s.leads}</td><td className="tabular px-3 py-2.5 text-right">{s.won}</td><td className="tabular px-3 py-2.5 text-right">{s.conv.toFixed(0)}%</td><td className="tabular px-3 py-2.5 text-right">{formatINR(s.pipeline)}</td><td className="tabular px-3 py-2.5 text-right">{s.spend ? formatINR(s.spend) : "—"}</td><td className="tabular px-3 py-2.5 text-right">{s.cpl ? formatINR(s.cpl) : "—"}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>Campaigns</CardTitle></CardHeader>
        {campaigns.length === 0 ? <EmptyState title="No campaigns yet" hint="Log your Instagram, Facebook and Google campaigns to see what they cost per lead." /> : (
          <ul className="divide-y divide-slate-100">
            {campaigns.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{x.name}</p><p className="text-xs text-slate-500">{x.channel} · {formatDate(x.startDate)} → {formatDate(x.endDate)}</p></div>
                <span className="tabular text-sm font-medium">{formatINR(x.spend)}</span>
                {c.can("marketing:edit") && <FormDialog title="Edit campaign" wide trigger={<Button size="sm" variant="ghost">Edit</Button>} fields={fields(x)} action={updateCampaign.bind(null, x.id)} />}
                {c.can("marketing:delete") && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteCampaign.bind(null, x.id)} confirm={{ title: `Delete “${x.name}”?`, confirmLabel: "Delete" }}>Delete</ActionButton>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
