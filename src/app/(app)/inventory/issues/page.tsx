import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten, listParams } from "@/lib/list";
import { projectOptions } from "@/lib/lookups";
import { formatDate, num } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";

export const metadata = { title: "Issues & Returns" };

export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("inventory:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "date", "desc", 20);
  const all = ["OWNER", "MANAGEMENT", "ADMIN", "STORE", "PROCUREMENT", "ACCOUNTS"].includes(c.role);
  const mine = all ? null : (await db.project.findMany({ where: projectScope(c), select: { id: true } })).map((p) => p.id);
  const where = { companyId: c.companyId, ...(mine ? { projectId: { in: mine } } : {}), ...(sp.project ? { projectId: sp.project } : {}), ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" as const } }, { receivedBy: { contains: lp.q, mode: "insensitive" as const } }, { purpose: { contains: lp.q, mode: "insensitive" as const } }] } : {}) };
  const [rows, total, projects, mats] = await Promise.all([
    db.materialIssue.findMany({ where, include: { project: { select: { code: true, name: true } }, items: true }, orderBy: { date: "desc" }, skip: lp.skip, take: lp.take }),
    db.materialIssue.count({ where }),
    projectOptions(c.companyId),
    db.material.findMany({ where: { companyId: c.companyId }, select: { id: true, name: true, unit: true } }),
  ]);
  const mn = new Map(mats.map((m) => [m.id, m]));
  return (
    <>
      <PageHeader
        title="Issues & returns"
        subtitle="Material moved to project sites, and unused material coming back."
        actions={c.can("inventory:create") && <><Link href="/inventory/issues/new?mode=return"><Button variant="secondary">Return from site</Button></Link><Link href="/inventory/issues/new"><Button>Issue to site</Button></Link></>}
      />
      <Card>
        <ListFilters placeholder="Search number, person or purpose…" filters={[{ key: "project", label: "Project", options: projects }]} />
        {rows.length === 0 ? <EmptyState title="Nothing issued yet" /> : (
          <>
            <Table>
              <THead><tr><Th>Note</Th><Th>Project</Th><Th>Materials</Th><Th>Received by</Th><Th>Purpose</Th></tr></THead>
              <tbody>
                {rows.map((r) => {
                  const isReturn = r.items.some((i) => num(i.quantity) < 0);
                  return (
                    <Tr key={r.id}>
                      <Td><p className="font-medium text-slate-900">{r.number} {isReturn && <Badge tone="teal">Return</Badge>}</p><p className="text-xs text-slate-500">{formatDate(r.date)}</p></Td>
                      <Td>{r.project.code} · {r.project.name}</Td>
                      <Td className="max-w-[300px] text-xs">{r.items.map((i) => `${mn.get(i.materialId)?.name ?? "?"} ×${Math.abs(num(i.quantity))}`).join(", ")}</Td>
                      <Td>{r.receivedBy ?? "—"}</Td><Td className="max-w-[220px] truncate text-xs">{r.purpose ?? ""}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/inventory/issues" />
          </>
        )}
      </Card>
    </>
  );
}
