import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getCtx } from "@/lib/auth";
import { homeFor } from "@/lib/home";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const c = await getCtx();
  if (c) redirect(homeFor(c.role));
  const { next } = await searchParams;

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-brand-950 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Building2 className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">DSC Interior Pvt. Ltd.</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">One system for the whole company.</h2>
          <p className="mt-4 text-slate-300">
            Leads to handover — quotations, BOQ, procurement, inventory, site teams, billing and profitability, all connected.
          </p>
        </div>
        <p className="text-xs text-slate-400">Design · Project management · Turnkey civil interiors · Fixtures</p>
      </section>
      <section className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue.</p>
          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}
