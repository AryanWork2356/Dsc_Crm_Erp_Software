/**
 * Copies every uploaded file from a database's StoredFile table into the Cloudflare R2 bucket (same key), then checks each one.
 *   npx tsx scripts/move-files.ts old     reads the live database (.env.old), only reads
 *   npx tsx scripts/move-files.ts new     reads the new database (.env.new)
 * Reads Cloudflare details from .env.r2. Safe to run again: the same key is simply written again with the same content.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const APP = process.cwd();
function envFile(name: string): Record<string, string> {
  const f = path.join(APP, name);
  if (!fs.existsSync(f)) throw new Error(`${name} was not found.`);
  return Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
}
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

async function main() {
  const which = process.argv[2] === "old" ? "old" : "new";
  const url = envFile(which === "old" ? ".env.old" : ".env.new").DATABASE_URL.replace(/[&?]channel_binding=require/, "");
  const r2 = envFile(".env.r2");
  const db = new PrismaClient({ datasourceUrl: url });
  const s3 = new S3Client({ region: "auto", endpoint: r2.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: r2.S3_ACCESS_KEY_ID, secretAccessKey: r2.S3_SECRET_ACCESS_KEY } });
  try {
    const files = await db.storedFile.findMany({ select: { key: true, data: true, size: true } });
    let ok = 0, bytes = 0;
    const bad: string[] = [];
    for (const f of files) {
      const buf = Buffer.from(f.data);
      const ext = f.key.split(".").pop()?.toLowerCase() ?? "";
      await s3.send(new PutObjectCommand({ Bucket: r2.S3_BUCKET, Key: f.key, Body: buf, ContentType: MIME[ext] ?? "application/octet-stream" }));
      const head = await s3.send(new HeadObjectCommand({ Bucket: r2.S3_BUCKET, Key: f.key }));
      if (head.ContentLength === buf.length) { ok++; bytes += buf.length; } else bad.push(f.key);
    }
    console.log(bad.length ? `FILES FAILED: ${bad.length} of ${files.length} did not match` : `FILES OK: ${ok} of ${files.length} files (${(bytes / 1048576).toFixed(1)} MB) are in Cloudflare and each size matches`);
    if (bad.length) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
main().catch((e) => { console.error("STOPPED:", e instanceof Error ? e.message : e); process.exitCode = 1; });
