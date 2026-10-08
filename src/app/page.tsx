import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { homeFor } from "@/lib/home";

export default async function Root() {
  const c = await getCtx();
  redirect(c ? homeFor(c.role) : "/login");
}
