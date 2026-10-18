import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * File storage abstraction. Development/single-server deployments use the local disk (UPLOAD_DIR).
 * On Vercel (no permanent disk) set STORAGE_DRIVER=s3 and the S3_* variables – works with AWS S3, Cloudflare R2,
 * Supabase Storage, DigitalOcean Spaces or any S3-compatible service. Files are always private: they are only
 * ever read back through the app (which checks who may see them), never by public link.
 */

const ROOT = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Only these types may be uploaded. Magic bytes are checked so a renamed .exe can't pass as .pdf.
const ALLOWED: Record<string, { mime: string; magic: number[][] | null }> = {
  pdf: { mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
  png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  webp: { mime: "image/webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  csv: { mime: "text/csv", magic: null },
  txt: { mime: "text/plain", magic: null },
  dwg: { mime: "application/octet-stream", magic: [[0x41, 0x43, 0x31]] },
};
export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

export type ValidatedFile = { ext: string; mime: string; size: number; bytes: Buffer; safeName: string };

export class UploadError extends Error {}

export async function validateUpload(file: File): Promise<ValidatedFile> {
  if (!file || file.size === 0) throw new UploadError("Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(`File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const rule = ALLOWED[ext];
  if (!rule) throw new UploadError(`.${ext || "?"} files aren't allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (rule.magic && !rule.magic.some((m) => m.every((b, i) => bytes[i] === b))) throw new UploadError("The file contents don't match its type.");
  // never trust the client-supplied name for paths – keep a sanitised display name only
  const safeName = file.name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
  return { ext, mime: rule.mime, size: bytes.length, bytes, safeName };
}

// ───────── local disk ─────────
function keyPath(key: string) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key"); // path-traversal guard
  return full;
}

const newKey = (companyId: string, ext: string) => `${companyId}/${crypto.randomUUID()}.${ext}`;
const validKey = (key: string) => /^[\w-]+\/[\w-]+\.[a-z0-9]{2,5}$/i.test(key);

// ───────── S3-compatible ─────────
let client: S3Client | null = null;
function s3() {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) throw new Error("File storage is set to S3 but S3_BUCKET, S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is missing.");
  client ??= new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined, // e.g. https://<account>.r2.cloudflarestorage.com
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
}
const s3Enabled = () => process.env.STORAGE_DRIVER === "s3";

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(ALLOWED).map(([e, r]) => [e, r.mime]));

export async function putFile(companyId: string, bytes: Buffer, ext: string): Promise<string> {
  const key = newKey(companyId, ext);
  if (s3Enabled()) {
    const { client: c, bucket } = s3();
    await c.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: MIME_BY_EXT[ext] ?? "application/octet-stream" }));
    return key;
  }
  const full = keyPath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  if (s3Enabled()) {
    if (!validKey(key)) throw new Error("Invalid storage key");
    const { client: c, bucket } = s3();
    const r = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!r.Body) throw new Error("File not found");
    return Buffer.from(await r.Body.transformToByteArray());
  }
  return fs.readFile(keyPath(key));
}

export async function deleteFile(key: string): Promise<void> {
  if (s3Enabled()) {
    if (!validKey(key)) return;
    const { client: c, bucket } = s3();
    await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }
  await fs.rm(keyPath(key), { force: true });
}
