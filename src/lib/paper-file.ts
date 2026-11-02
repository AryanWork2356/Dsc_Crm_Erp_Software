import "server-only";
import { UserError } from "./action";
import { UploadError, validateUpload, type ValidatedFile } from "./storage";
import type { AiPart } from "./ai";

/**
 * A photo or PDF of a paper (delivery challan, client purchase order, BOQ …) taken from a form field, checked like every other upload,
 * and turned into what the AI reader takes. Nothing is saved here.
 */
export async function readPaper(fd: FormData, field: string, what: string): Promise<{ file: ValidatedFile; part: AiPart } | null> {
  const f = fd.get(field);
  if (!(f instanceof File) || f.size === 0) return null;
  if (!/\.(jpe?g|png|webp|pdf)$/i.test(f.name)) throw new UserError(`The ${what} must be a photo (JPG, PNG, WebP) or a PDF.`);
  let v: ValidatedFile;
  try { v = await validateUpload(f); } catch (e) { if (e instanceof UploadError) throw new UserError(e.message); throw e; }
  return { file: v, part: v.mime === "application/pdf" ? { pdf: v.bytes } : { image: v.bytes, mime: v.mime } };
}

/** A date the AI returned, kept only if it is a real day in a believable window (nobody's paper is from 1990 or next year). */
export function sensibleDate(v: string | null | undefined, opts: { future?: boolean } = {}, now = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  const y = now.getUTCFullYear();
  if (+m[1] < y - 3 || +m[1] > y + 1) return null;
  if (!opts.future && d.getTime() > now.getTime() + 2 * 86400000) return null;
  return v!.trim();
}

export const cleanText = (v: string | null | undefined, max: number): string | null => { const t = (v ?? "").replace(/\s+/g, " ").trim().slice(0, max); return t || null; };
