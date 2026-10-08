import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { formatDate, humanize } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { createEmployee } from "../actions";
import { employeeFields } from "./employee-fields";

export const metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("employees:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "name", "asc", 25);
  const where: Prisma.EmployeeWhereInput = {
    companyId: c.companyId, deletedAt: null,
    ...(sp.department ? { department: sp.department } : {}),
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { code: { contains: lp.q, mode: "insensitive" } }, { designation: { contains: lp.q, mode: "insensitive" } }, { phone: { contains: lp.q } }] } : {}),
  };
  const [rows, total, depts, all] = await Promise.all([
    db.employee.findMany({ where, orderBy: { name: "asc" }, skip: lp.skip, take: lp.take, include: { user: { select: { role: true, isActive: true } } } }),
    db.employee.count({ where }),
    db.employee.findMany({ where: { companyId: c.companyId, deletedAt: null, department: { not: null } }, distinct: ["department"], select: { department: true } }),
    db.employee.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="Employees" subtitle="Office and site staff." actions={c.can("employees:create") && <FormDialog title="Onboard employee" wide trigger={<Button>Add employee</Button>} fields={employeeFields(all.map((e) => ({ value: e.id, label: e.name })))} action={createEmployee} successMessage="Employee added" />} />
      <Card>
        <ListFilters placeholder="Search name, ID, designation…" filters={[{ key: "department", label: "Department", options: depts.map((d) => ({ value: d.department!, label: d.department! })) }, { key: "status", label: "Status", options: ["ACTIVE", "ON_LEAVE", "EXITED"].map((s) => ({ value: s, label: humanize(s) })) }]} />
        {rows.length === 0 ? <EmptyState title="No employees found" /> : (
          <>
            <Table>
              <THead><tr><Th>Employee</Th><Th>Department</Th><Th>Phone</Th><Th>Joined</Th><Th>Login</Th><Th>Status</Th></tr></THead>
              <tbody>
                {rows.map((e) => (
                  <Tr key={e.id}>
                    <Td><Link href={`/hr/employees/${e.id}`} className="font-medium text-slate-900 hover:text-brand-700">{e.name}</Link><p className="text-xs text-slate-500">{e.code} · {e.designation ?? "—"}</p></Td>
                    <Td>{e.department ?? "—"}</Td><Td>{e.phone ?? "—"}</Td><Td>{formatDate(e.joiningDate)}</Td>
                    <Td>{e.user ? <Badge tone={e.user.isActive ? "green" : "slate"}>{humanize(e.user.role)}</Badge> : <span className="text-slate-400">No login</span>}</Td>
                    <Td><StatusBadge status={e.status} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/hr/employees" />
          </>
        )}
      </Card>
    </>
  );
}
