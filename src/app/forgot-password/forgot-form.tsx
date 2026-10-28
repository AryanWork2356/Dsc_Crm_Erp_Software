"use client";
import { useActionState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  if (state?.done)
    return (
      <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        If that login ID is right, the Owner and Admin have been told. They will check it is you and tell you your password.
      </p>
    );
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Your login ID</label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus placeholder="name.surname@dscinterior.com" className="h-12 w-full rounded-xl border border-slate-300 bg-slate-50 pl-11 pr-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100" />
        </div>
      </div>
      {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{state.error}</p>}
      <Button type="submit" size="lg" className="h-12 w-full rounded-xl text-base" loading={pending}>Ask for a new password</Button>
    </form>
  );
}
