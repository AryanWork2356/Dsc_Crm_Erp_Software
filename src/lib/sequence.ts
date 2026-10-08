import type { Tx } from "./db";

/**
 * Atomic per-company running numbers, e.g. QT-00045. Must be called inside a transaction
 * so a failed save does not burn a number and concurrent saves never collide.
 */
export async function nextNumber(tx: Tx, companyId: string, key: string, width = 5) {
  const row = await tx.sequence.upsert({
    where: { companyId_key: { companyId, key } },
    create: { companyId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${key}-${String(row.value).padStart(width, "0")}`;
}

type DocKind = "quotation" | "po" | "invoice";

/** Like nextNumber, but the prefix comes from Company Settings (Quotation / PO / Invoice prefix). */
export async function nextDocNumber(tx: Tx, companyId: string, kind: DocKind) {
  const s = await tx.companySettings.findUnique({ where: { companyId } });
  const prefix = (kind === "quotation" ? s?.quotationPrefix : kind === "po" ? s?.poPrefix : s?.invoicePrefix) ?? { quotation: "QT", po: "PO", invoice: "INV" }[kind];
  return nextNumber(tx, companyId, prefix);
}
