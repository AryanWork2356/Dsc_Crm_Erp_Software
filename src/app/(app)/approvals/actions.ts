"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/lib/auth";
import { run } from "@/lib/action";
import { decide } from "@/lib/workflow";

function revalidate() {
  for (const p of ["/approvals", "/dashboard", "/sales/quotations", "/sales/boq", "/procurement/requests", "/procurement/orders", "/finance/invoices", "/finance/expenses"]) revalidatePath(p);
}

export async function approveRequest(id: string, fd?: FormData) {
  return run(async () => {
    const c = await assertPerm("approvals:approve");
    await decide(c, id, true, fd ? String(fd.get("remarks") ?? "") : undefined);
    revalidate();
    return { message: "Approved" };
  });
}

export async function rejectRequest(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("approvals:approve");
    await decide(c, id, false, String(fd.get("remarks") ?? ""));
    revalidate();
    return { message: "Rejected" };
  });
}
