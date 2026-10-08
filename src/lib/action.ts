import { ZodError } from "zod";
import { PermissionError } from "./auth";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Wrap a server-action body so every failure is returned (never thrown/silent). */
export async function run<T>(fn: () => Promise<T | { message: string; data?: T } | void>): Promise<ActionResult<T>> {
  try {
    const r = (await fn()) as { message?: string; data?: T } | T | void;
    if (r && typeof r === "object" && "message" in (r as object)) {
      const x = r as { message: string; data?: T };
      return { ok: true, message: x.message, data: x.data };
    }
    return { ok: true, data: (r ?? undefined) as T };
  } catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const i of e.issues) fieldErrors[i.path.join(".") || "_"] ??= i.message;
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
    }
    if (e instanceof PermissionError || e instanceof UserError) return { ok: false, error: e.message };
    // Next's redirect()/notFound() must propagate
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Business-rule error with a message that is safe to show users. */
export class UserError extends Error {}
