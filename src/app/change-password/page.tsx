import Link from "next/link";
import { requireCtx } from "@/lib/auth";
import { homeFor } from "@/lib/home";
import { PasswordForm } from "./password-form";
import { USE_SELF_PASSWORD } from "@/lib/features";
import { redirect } from "next/navigation";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const c = await requireCtx();
  if (!USE_SELF_PASSWORD && !c.mustChangePassword) redirect(homeFor(c.role)); // passwords are changed by the Admin
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-brand-900/10 sm:p-9">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand-900">{c.mustChangePassword ? "Choose your own password" : "Change my password"}</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {c.mustChangePassword ? "The password you signed in with was given to you by someone else. Choose one only you know, then continue." : <>Signed in as <b className="text-slate-700">{c.email}</b></>}
        </p>
        <div className="mt-5 h-0.5 w-12 rounded bg-accent" />
        <PasswordForm />
        {!c.mustChangePassword && <p className="mt-6 text-center text-sm"><Link href={homeFor(c.role)} className="text-brand-700 hover:underline">Back</Link></p>}
        <p className="mt-4 text-center text-xs text-slate-500">Your login ID is given by DSC and cannot be changed here.</p>
      </div>
    </main>
  );
}
