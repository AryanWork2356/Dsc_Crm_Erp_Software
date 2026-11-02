import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { canOpenDocument } from "@/lib/doc-access";
import { getFile } from "@/lib/storage";
import { audit } from "@/lib/audit";

/** Access-controlled download. Files are never served from a public folder. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCtx();
  if (!c) return new Response("Sign in required", { status: 401 });
  const d = await db.document.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
  if (!d || !(await canOpenDocument(c, d))) return new Response("Not found", { status: 404 }); // 404, not 403: don't reveal existence
  // Photos and voice notes shown on a page: the phone keeps its copy and only asks "has it changed?" (a few bytes instead of the
  // whole file every time a report is opened). The tag is the stored file itself, so a new version is always fetched; access is checked above first.
  const viewing = req.nextUrl.searchParams.get("inline") === "1";
  const etag = `"${d.storageKey}"`;
  const keep = { "Cache-Control": "private, no-cache", ETag: etag };
  if (viewing && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: keep });
  let bytes: Buffer;
  try {
    bytes = await getFile(d.storageKey);
  } catch {
    return new Response("File is missing from storage", { status: 410 });
  }
  const inline = req.nextUrl.searchParams.get("inline") === "1" && (d.mimeType.startsWith("image/") || d.mimeType.startsWith("audio/") || d.mimeType === "application/pdf");
  if (!inline) await audit(c, { action: "DOWNLOAD", entityType: "Document", entityId: id, summary: `Downloaded “${d.name}”` });
  const ext = d.storageKey.split(".").pop();
  const filename = d.name.includes(".") ? d.name : `${d.name}.${ext}`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": d.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(filename)}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      ...(inline ? keep : { "Cache-Control": "private, no-store" }),
    },
  });
}
