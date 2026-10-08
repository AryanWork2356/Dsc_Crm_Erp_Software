import { vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { db } from "@/lib/db";

/**
 * Test harness: server actions read the session from next/headers cookies. We swap in a fake cookie
 * store so tests can "log in" as any demo user and call the REAL actions against the real test DB.
 */
export const state = { token: null as string | null };

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const e = new Error("NEXT_REDIRECT:" + url) as Error & { digest: string };
    e.digest = "NEXT_REDIRECT;" + url;
    throw e;
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === SESSION_COOKIE && state.token ? { name: n, value: state.token } : undefined),
    set: (n: string, v: string) => {
      if (n === SESSION_COOKIE) state.token = v;
    },
    delete: () => {
      state.token = null;
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));
// React's cache() dedupes per request; in tests every call is a fresh request.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

export async function loginAs(email: string) {
  const u = await db.user.findFirstOrThrow({ where: { email } });
  state.token = await signSession({ uid: u.id, cid: u.companyId });
  return u;
}

export function logout() {
  state.token = null;
}

export function fd(o: Record<string, string | number | boolean | null | undefined>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}
