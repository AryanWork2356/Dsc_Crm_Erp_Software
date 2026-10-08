import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams, orderBy } from "@/lib/list";
import { formatINR, num } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, SortTh, Pagination } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { createVendor } from "../actions";
import { vendorFields } from "./vendor-fields";

export const metadata = { title: "Vendors" };

export default async function VendorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("vendors:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "name", "asc", 20);
  const where: Prisma.VendorWhereInput = {
    companyId: c.companyId,
    deletedAt: null,
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { code: { contains: lp.q, mode: "insensitive" } }, { categories: { contains: lp.q, mode: "insensitive" } }, { phone: { contains: lp.q } }, { gstin: { contains: lp.q, mode: "insensitive" } }] } : {}),
  };
  const showMoney = c.can("vendor_bills:view");
  const [rows, total] = await Promise.all([
    db.vendor.findMany({
      where, orderBy: orderBy(lp.sort, lp.dir, ["name", "code", "createdAt", "rating"] as const, "name"), skip: lp.skip, take: lp.take,
      include: { _count: { select: { purchaseOrders: true } }, purchaseOrders: { where: { status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { total: true } }, bills: { where: { status: { not: "CANCELLED" } }, select: { amount: true, paid: true } } },
    }),
    db.vendor.count({ where }),
  ]);

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle="Suppliers and sub-contractors you buy from."
        actions={c.can("vendors:create") && <FormDialog title="New vendor" wide trigger={<Button>Add vendor</Button>} fields={vendorFields(null, c.can("vendor_bills:view"))} action={createVendor} successMessage="Vendor created" />}
      />
      <Card>
        <ListFilters placeholder="Search name, category, GSTIN…" />
        {rows.length === 0 ? (
          <EmptyState title="No vendors found" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <SortTh label="Vendor" field="name" sp={sp} basePath="/procurement/vendors" />
                  <Th>Supplies</Th><Th>Contact</Th><Th right>Orders</Th>
                  {showMoney && <><Th right>Total purchased</Th><Th right>Payable</Th></>}
                  <SortTh label="Rating" field="rating" sp={sp} basePath="/procurement/vendors" right />
                </tr>
              </THead>
              <tbody>
                {rows.map((v) => {
                  const bought = v.purchaseOrders.reduce((s, p) => s + num(p.total), 0);
                  const payable = v.bills.reduce((s, b) => s + num(b.amount) - num(b.paid), 0);
                  return (
                    <Tr key={v.id}>
                      <Td><Link href={`/procurement/vendors/${v.id}`} className="font-medium text-slate-900 hover:text-brand-700">{v.name}</Link><p className="text-xs text-slate-500">{v.code}</p></Td>
                      <Td className="max-w-[200px] truncate">{v.categories ?? "—"}</Td>
                      <Td>{v.contactPerson ?? "—"}<p className="text-xs text-slate-500">{v.phone}</p></Td>
                      <Td right>{v._count.purchaseOrders}</Td>
                      {showMoney && <><Td right>{formatINR(bought)}</Td><Td right className={payable > 0 ? "font-medium text-amber-700" : ""}>{formatINR(payable)}</Td></>}
                      <Td right>{v.rating ? `${"★".repeat(v.rating)}` : "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/procurement/vendors" />
          </>
        )}
      </Card>
    </>
  );
}
