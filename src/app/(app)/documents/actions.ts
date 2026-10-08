"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DocumentType } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { canUploadTo, ENTITY_TYPES } from "@/lib/doc-access";
import { putFile, deleteFile, validateUpload, UploadError } from "@/lib/storage";
import { formToObject, zOptDate, zOptStr } from "@/lib/form";

const schema = z.object({
  attachTo: zOptStr, // "PROJECT:abc123" (library upload) …
  entityType: zOptStr, // … or explicit pair (record pages)
  entityId: zOptStr,
  name: zOptStr,
  type: z.nativeEnum(DocumentType).default("OTHER"),
  folder: zOptStr,
  tags: zOptStr,
  expiresAt: zOptDate,
  isPortalVisible: z.boolean().default(false),
});

export async function uploadDocument(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("documents:create");
    const d = schema.parse(formToObject(fd));
    let entityType = d.entityType ?? null;
    let entityId = d.entityId ?? null;
    if (d.attachTo) [entityType, entityId] = d.attachTo.includes(":") ? (d.attachTo.split(":") as [string, string]) : ["GENERAL", null as unknown as string];
    entityType ||= "GENERAL";
    if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) throw new UserError("Unknown record type.");
    if (entityType === "GENERAL") entityId = null;
    if (!(await canUploadTo(c, entityType, entityId))) throw new UserError("You don't have access to attach files to that record.");
    if (d.isPortalVisible && !c.can("documents:manage") && !["PROJECT_MANAGER", "SALES", "ACCOUNTS"].includes(c.role)) throw new UserError("You can't share files with clients or vendors.");

    const file = fd.get("file");
    if (!(file instanceof File)) throw new UserError("Choose a file to upload.");
    let v;
    try {
      v = await validateUpload(file);
    } catch (e) {
      if (e instanceof UploadError) throw new UserError(e.message);
      throw e;
    }
    const name = d.name?.trim() || v.safeName;
    const key = await putFile(c.companyId, v.bytes, v.ext);
    try {
      const prev = await db.document.findFirst({ where: { companyId: c.companyId, entityType, entityId, name: { equals: name, mode: "insensitive" }, deletedAt: null }, orderBy: { version: "desc" } });
      const doc = await db.document.create({
        data: { companyId: c.companyId, name, type: d.type, folder: d.folder, tags: d.tags, entityType, entityId, storageKey: key, mimeType: v.mime, size: v.size, version: (prev?.version ?? 0) + 1, expiresAt: d.expiresAt, uploadedById: c.userId, isPortalVisible: d.isPortalVisible },
      });
      await audit(c, { action: "CREATE", entityType: "Document", entityId: doc.id, summary: `Uploaded “${name}” v${doc.version} (${(v.size / 1024).toFixed(0)} KB) to ${entityType.toLowerCase()}` });
    } catch (e) {
      await deleteFile(key); // don't leave orphan files if the record couldn't be saved
      throw e;
    }
    revalidatePath("/documents");
    if (entityType === "PROJECT") revalidatePath(`/projects/${entityId}`);
    return { message: "File uploaded" };
  });
}

export async function deleteDocument(id: string) {
  return run(async () => {
    const c = await assertPerm("documents:view");
    const d = await db.document.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!d) throw new UserError("Document not found.");
    if (d.uploadedById !== c.userId && !c.can("documents:delete")) throw new UserError("You can only remove files you uploaded.");
    await db.document.update({ where: { id }, data: { deletedAt: new Date() } }); // file kept on disk for recovery
    await audit(c, { action: "DELETE", entityType: "Document", entityId: id, summary: `Removed document “${d.name}” v${d.version}` });
    revalidatePath("/documents");
    if (d.entityType === "PROJECT") revalidatePath(`/projects/${d.entityId}`);
    return { message: "Document removed" };
  });
}

export async function setPortalVisibility(id: string, visible: boolean) {
  return run(async () => {
    const c = await assertPerm("documents:edit");
    const d = await db.document.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!d) throw new UserError("Document not found.");
    if (!["PROJECT", "QUOTATION", "INVOICE", "BOQ", "PO", "TICKET"].includes(d.entityType ?? "")) throw new UserError("Only project, quotation, invoice, BOQ, PO and ticket files can be shared with clients or vendors.");
    await db.document.update({ where: { id }, data: { isPortalVisible: visible } });
    await audit(c, { action: "UPDATE", entityType: "Document", entityId: id, summary: `${visible ? "Shared" : "Unshared"} “${d.name}” ${visible ? "with" : "from"} the client/vendor portal` });
    revalidatePath("/documents");
    return { message: visible ? "Shared with the portal" : "No longer shared" };
  });
}
