import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ListFilters } from "@/components/list/list-filters";
import { formatDateTime } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Audit Log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("audit:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 30);

  const where: Prisma.AuditLogWhereInput = {
    companyId: c.companyId,
    ...(sp.entity ? { entityType: sp.entity } : {}),
    ...(sp.action ? { action: sp.action } : {}),
    ...(lp.q ? { OR: [{ summary: { contains: lp.q, mode: "insensitive" } }, { userName: { contains: lp.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, entities] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where: { companyId: c.companyId }, distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Audit Log" subtitle="A permanent record of who did what. Entries can't be edited or deleted." />
      <Card>
        <ListFilters
          placeholder="Search by user or description…"
          filters={[
            { key: "entity", label: "Record type", options: entities.map((e) => ({ value: e.entityType, label: e.entityType })) },
            { key: "action", label: "Action", options: ["CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT", "LOGIN", "LOGOUT"].map((a) => ({ value: a, label: a })) },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <>
            <Table>
              <THead>
                <tr><Th>When</Th><Th>User</Th><Th>Action</Th><Th>What happened</Th><Th>IP</Th></tr>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
                    <Td>{r.userName ?? "System"}</Td>
                    <Td><Badge tone={r.action === "DELETE" || r.action === "REJECT" ? "red" : r.action === "APPROVE" ? "green" : "slate"}>{r.action}</Badge></Td>
                    <Td>{r.summary}</Td>
                    <Td className="text-xs text-slate-500">{r.ip ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/settings/audit" />
          </>
        )}
      </Card>
    </>
  );
}
