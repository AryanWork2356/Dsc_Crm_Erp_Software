import { requirePerm } from "@/lib/auth";
import { USE_SALES_TEAM } from "@/lib/features";
import { ensureEmployees } from "@/lib/employee-code";
import { db } from "@/lib/db";
import { OFFERED_ROLES, ROLE_LABELS } from "@/lib/permissions";
import { shortLoginId } from "@/lib/issued-password";
import { StaffLogins } from "./staff-logins";
import { flatten, listParams } from "@/lib/list";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog, type FieldDef } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { formatDateTime } from "@/lib/utils";
import { createUser, resetPassword, setUserActive, updateUser } from "../actions";
import type { Prisma, RoleKey } from "@prisma/client";

export const metadata = { title: "Team & Users" };

// DSC gives only its own roles (lib/permissions OFFERED_ROLES); a person who already has another role keeps it until changed
const offered = (extra: RoleKey[] = []) => [...new Set<RoleKey>([...OFFERED_ROLES, ...(USE_SALES_TEAM ? ["SALES" as RoleKey] : []), ...extra])].map((value) => ({ value, label: ROLE_LABELS[value] }));

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("team:view");
  await ensureEmployees(c.companyId);
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 20);
  const canManage = c.can("users:manage");

  const where: Prisma.UserWhereInput = {
    companyId: c.companyId,
    deletedAt: null,
    ...(sp.role ? { role: sp.role as RoleKey } : {}),
    ...(sp.status ? { isActive: sp.status === "active" } : {}),
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { email: { contains: lp.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { name: "asc" }, skip: lp.skip, take: lp.take }),
    db.user.count({ where }),
  ]);

  const baseFields: FieldDef[] = [
    { name: "name", label: "Full name", required: true },
    { name: "email", label: "Login ID", required: true, placeholder: "e.g. aryan.s@dsc", hint: "First name, a dot, first letter of the surname, @dsc" },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "role", label: "Role", type: "select", required: true, options: offered(c.role === "OWNER" ? ["OWNER"] : []) },
  ];
  const addFields = baseFields;

  return (
    <>
      <PageHeader
        title="Team & Users"
        subtitle="Everyone who can sign in. Their role decides which menus and data they see."
        actions={
          canManage && (
            <FormDialog
              title="Add user"
              trigger={<Button>Add user</Button>}
              fields={[...addFields, { name: "password", label: "Password (leave empty for a 4-digit one)", type: "password", hint: "Leave it empty: the app makes a 4-digit password and shows it once." }]}
              action={createUser}
              successMessage="User created"
            />
          )
        }
      />
      {c.role === "OWNER" && <StaffLogins />}
      <Card>
        <ListFilters
          placeholder="Search name or email…"
          filters={[
            { key: "role", label: "Role", options: offered(["OWNER"]) },
            { key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState title="No users found" hint="Try clearing the filters." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Phone</Th>
                  <Th>Last sign-in</Th>
                  <Th>Status</Th>
                  {canManage && <Th right>Actions</Th>}
                </tr>
              </THead>
              <tbody>
                {rows.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <p className="font-medium text-slate-900">{u.name}</p>
                      <p className="text-xs text-slate-500">{shortLoginId(u.email)}</p>
                    </Td>
                    <Td>{ROLE_LABELS[u.role]}</Td>
                    <Td>{u.phone ?? "—"}</Td>
                    <Td>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</Td>
                    <Td>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}{u.resetRequestedAt && <div className="mt-1"><Badge tone="amber">Asked for a password reset</Badge></div>}</Td>
                    {canManage && (
                      <Td right>
                        <div className="flex justify-end gap-1">
                          <FormDialog
                            title={`Edit ${u.name}`}
                            trigger={<Button size="sm" variant="ghost">Edit</Button>}
                            fields={baseFields.map((f) => ({ ...f, ...(f.name === "role" ? { options: offered([u.role, ...(c.role === "OWNER" ? ["OWNER" as RoleKey] : [])]) } : {}), defaultValue: f.name === "email" ? shortLoginId(u.email) : (u as unknown as Record<string, string | null>)[f.name] }))}
                            action={updateUser.bind(null, u.id)}
                          />
                          <FormDialog
                            title={`Reset password – ${u.name}`}
                            trigger={<Button size="sm" variant="ghost">Reset password</Button>}
                            fields={[{ name: "password", label: "New password (leave empty for a 4-digit one)", type: "password", hint: "Shown once after you save: write it in your list." }]}
                            action={resetPassword.bind(null, u.id)}
                            submitLabel="Reset password"
                          />
                          {u.id !== c.userId && (
                            <ActionButton
                              size="sm"
                              variant={u.isActive ? "ghost" : "secondary"}
                              action={setUserActive.bind(null, u.id, !u.isActive)}
                              confirm={u.isActive ? { title: `Deactivate ${u.name}?`, body: "They will be signed out and unable to log in. Their records are kept.", confirmLabel: "Deactivate" } : undefined}
                            >
                              {u.isActive ? "Deactivate" : "Activate"}
                            </ActionButton>
                          )}
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/settings/team" />
          </>
        )}
      </Card>
    </>
  );
}
