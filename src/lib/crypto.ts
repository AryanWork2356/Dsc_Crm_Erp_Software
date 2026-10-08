import "server-only";
import crypto from "node:crypto";

/** AES-256-GCM for integration secrets (API tokens) stored in the database. Key is derived from AUTH_SECRET. */
function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (min 32 chars)");
  return crypto.createHash("sha256").update(`dsc-erp:secrets:${s}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(value: string | undefined | null): string {
  if (!value) return "";
  if (!value.startsWith("enc:v1:")) return value; // legacy plain value
  const [, , iv, tag, data] = value.split(":");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return ""; // wrong key / tampered → treat as not configured
  }
}
