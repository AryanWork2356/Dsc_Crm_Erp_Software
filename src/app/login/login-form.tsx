"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { login } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(login, undefined);
  return (
    <form action={formAction} className="mt-8 space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email" required>
        <Input name="email" type="email" autoComplete="username" required autoFocus placeholder="you@company.com" />
      </Field>
      <Field label="Password" required>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state?.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Sign in
      </Button>
    </form>
  );
}
