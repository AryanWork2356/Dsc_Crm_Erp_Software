import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * File storage abstraction. Development/single-server deployments use the local disk (UPLOAD_DIR).
 * To move to S3-compatible storage, implement the same three functions against the S3 SDK and switch
 * on STORAGE_DRIVER=s3 – nothing else in the app needs to change.
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

function keyPath(key: string) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key"); // path-traversal guard
  return full;
}

export async function putFile(companyId: string, bytes: Buffer, ext: string): Promise<string> {
  const key = `${companyId}/${crypto.randomUUID()}.${ext}`;
  const full = keyPath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  return fs.readFile(keyPath(key));
}

export async function deleteFile(key: string): Promise<void> {
  await fs.rm(keyPath(key), { force: true });
}
