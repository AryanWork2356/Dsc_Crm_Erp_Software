export type SP = Record<string, string | undefined>;

/** Normalises Next's searchParams (string | string[]) into a flat string map. */
export function flatten(raw: Record<string, string | string[] | undefined>): SP {
  const out: SP = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

export function listParams(sp: SP, defaultSort: string, defaultDir: "asc" | "desc" = "desc", pageSize = 20) {
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  return {
    q: sp.q?.trim() ?? "",
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    sort: sp.sort ?? defaultSort,
    dir: (sp.dir === "asc" || sp.dir === "desc" ? sp.dir : defaultDir) as "asc" | "desc",
  };
}

/** Builds a safe orderBy only for whitelisted fields. */
export function orderBy<T extends string>(field: string, dir: "asc" | "desc", allowed: readonly T[], fallback: T) {
  const f = (allowed as readonly string[]).includes(field) ? field : fallback;
  return { [f]: dir } as Record<string, "asc" | "desc">;
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return "﻿" + [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

export function csvResponse(filename: string, headers: string[], rows: unknown[][]) {
  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
