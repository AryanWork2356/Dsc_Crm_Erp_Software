import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A stand-in for the S3 service: keeps files in memory and records every command it receives.
const sent: { type: string; input: Record<string, unknown> }[] = [];
const bucket = new Map<string, Buffer>();
vi.mock("@aws-sdk/client-s3", () => {
  class Cmd { constructor(public input: Record<string, unknown>) {} }
  class PutObjectCommand extends Cmd {}
  class GetObjectCommand extends Cmd {}
  class DeleteObjectCommand extends Cmd {}
  class S3Client {
    static last: { config: Record<string, unknown> } | null = null;
    constructor(public config: Record<string, unknown>) { S3Client.last = this; }
    async send(cmd: Cmd) {
      const type = cmd.constructor.name;
      sent.push({ type, input: cmd.input });
      const key = String(cmd.input.Key);
      if (type === "PutObjectCommand") { bucket.set(key, cmd.input.Body as Buffer); return {}; }
      if (type === "GetObjectCommand") { const b = bucket.get(key); return { Body: b ? { transformToByteArray: async () => new Uint8Array(b) } : undefined }; }
      bucket.delete(key);
      return {};
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

import { putFile, getFile, deleteFile } from "@/lib/storage";

const env = { ...process.env };
beforeEach(() => {
  sent.length = 0;
  bucket.clear();
  Object.assign(process.env, { STORAGE_DRIVER: "s3", S3_BUCKET: "dsc-files", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_ENDPOINT: "https://example.r2.cloudflarestorage.com" });
});
afterEach(() => { process.env = { ...env }; });

describe("cloud file storage (S3-compatible)", () => {
  it("stores, reads back and deletes a file under a company-scoped, unguessable key", async () => {
    const key = await putFile("company1", Buffer.from("hello"), "pdf");
    expect(key).toMatch(/^company1\/[0-9a-f-]{36}\.pdf$/);
    const put = sent.find((s) => s.type === "PutObjectCommand")!;
    expect(put.input).toMatchObject({ Bucket: "dsc-files", Key: key, ContentType: "application/pdf" });
    expect((await getFile(key)).toString()).toBe("hello");
    await deleteFile(key);
    expect(bucket.has(key)).toBe(false);
    await expect(getFile(key)).rejects.toThrow(/not found/i);
  });

  it("refuses keys that could point anywhere else in the bucket", async () => {
    await expect(getFile("../secrets/file.pdf")).rejects.toThrow(/invalid/i);
    await expect(getFile("company1/sub/dir/x.pdf")).rejects.toThrow(/invalid/i);
    await deleteFile("../x.pdf"); // ignored, never sent
    expect(sent.filter((s) => s.type === "DeleteObjectCommand")).toHaveLength(0);
  });

  it("says clearly what is missing when the S3 settings are incomplete", async () => {
    delete process.env.S3_BUCKET;
    await expect(putFile("company1", Buffer.from("x"), "pdf")).rejects.toThrow(/S3_BUCKET/);
  });
});
