export const CATEGORIES = ["MATERIAL", "LABOUR", "VENDOR", "TRAVEL", "OFFICE", "PETTY_CASH", "MISC"] as const;

/** What any reader (the free Google text reader, or the AI reader) hands back, before it is cleaned. */
export type RawBill = {
  isBill: boolean; readable: boolean; handwritten: boolean;
  vendorName: string | null; vendorGstin: string | null; billNumber: string | null; billDate: string | null; dueDate: string | null;
  totalAmount: number | null; taxAmount: number | null; description: string | null; category: (typeof CATEGORIES)[number]; unsure: string[]; note: string | null;
};

export class BillReadError extends Error {}
