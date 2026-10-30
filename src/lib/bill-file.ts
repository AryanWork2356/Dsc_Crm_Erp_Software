import "server-only";
import type { Ctx } from "./auth";
import type { Tx } from "./db";
import { UserError } from "./action";
import { deleteFile, putFile, UploadError, validateUpload, type ValidatedFile } from "./storage";

/**
 * The picture or PDF of a bill, kept with the expense or vendor bill it belongs to (in the same private document store as every other file).
 * `readBillFile` checks the upload BEFORE anything is saved; `keepBill` stores it and links it to the record inside the same transaction.
 */
export const BILL_EXTENSIONS = /\.(jpe?g|png|webp|pdf)$/i;

export async function readBillFile(fd: FormData): Promise<ValidatedFile | null> {
  const f = fd.get("billFile");
  if (!(f instanceof File) || f.size === 0) return null;
  if (!BILL_EXTENSIONS.test(f.name)) throw new UserError("The bill must be a photo (JPG, PNG, WebP) or a PDF.");
  try {
    return await validateUpload(f);
  } catch (e) {
    if (e instanceof UploadError) throw new UserError(e.message);
    throw e;
  }
}

/** Saves the file and links it to the record. Returns the storage key so the caller can remove the file if the record could not be saved. */
export async function keepBill(c: Ctx, tx: Tx, v: ValidatedFile, entityType: "EXPENSE" | "VENDOR_BILL", entityId: string, name: string): Promise<string> {
  const key = await putFile(c.companyId, v.bytes, v.ext);
  try {
    await tx.document.create({ data: { companyId: c.companyId, name: name.slice(0, 120), type: "BILL", entityType, entityId, storageKey: key, mimeType: v.mime, size: v.size, uploadedById: c.userId, tags: "bill" } });
  } catch (e) {
    await deleteFile(key);
    throw e;
  }
  return key;
}

export { deleteFile };
