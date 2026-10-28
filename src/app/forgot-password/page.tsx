import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-brand-900/10 sm:p-9">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand-900">Forgot your password?</h1>
        <p className="mt-1.5 text-sm text-slate-500">Type your login ID. The Owner and Admin will be told and will give you your password.</p>
        <div className="mt-5 h-0.5 w-12 rounded bg-accent" />
        <ForgotForm />
        <p className="mt-6 text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">Back to sign in</Link></p>
        <p className="mt-4 text-center text-xs text-slate-500">Do not know your login ID? Ask the Owner or Admin: IDs are given by DSC.</p>
      </div>
    </main>
  );
}
