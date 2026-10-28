"use client";
import * as React from "react";
import { useActionState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { changeMyPassword } from "./actions";

const input = "h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changeMyPassword, undefined);
  const [show, setShow] = React.useState(false);
  const field = (id: string, label: string, auto: string) => (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <input id={id} name={id} type={show ? "text" : "password"} autoComplete={auto} required className={input} />
    </div>
  );
  return (
    <form action={action} className="mt-6 space-y-4">
      {field("current", "Password you were given (or your current one)", "current-password")}
      {field("next", "New password", "new-password")}
      {field("again", "New password again", "new-password")}
      <button type="button" onClick={() => setShow((s) => !s)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {show ? "Hide" : "Show"} passwords
      </button>
      <p className="text-xs text-slate-500">At least 8 characters, with letters and numbers. Do not use your name.</p>
      {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{state.error}</p>}
      <Button type="submit" size="lg" className="h-12 w-full rounded-xl text-base" loading={pending}>Save my password</Button>
    </form>
  );
}
