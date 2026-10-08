import { humanize } from "./utils";

export type Opt = { value: string; label: string };
const opts = (vals: readonly string[], labels: Record<string, string> = {}): Opt[] =>
  vals.map((v) => ({ value: v, label: labels[v] ?? humanize(v) }));

export const LEAD_STAGES = [
  "NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT_SCHEDULED", "SITE_VISIT_COMPLETED",
  "PROPOSAL_IN_PROGRESS", "QUOTATION_SENT", "NEGOTIATION", "WON", "LOST", "ON_HOLD",
] as const;
export const LEAD_STAGE_OPTS = opts(LEAD_STAGES);
export const OPEN_LEAD_STAGES = LEAD_STAGES.filter((s) => s !== "WON" && s !== "LOST" && s !== "ON_HOLD");

export const SEGMENTS = ["RESIDENTIAL", "COMMERCIAL", "RETAIL", "CORPORATE", "HOTEL"] as const;
export const SEGMENT_OPTS = opts(SEGMENTS);

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const PRIORITY_OPTS = opts(PRIORITIES);

export const LEAD_SOURCES = ["Website", "Instagram", "Facebook", "Google Ads", "Referral", "Walk-in", "Architect / Designer", "Existing Client", "Exhibition", "Other"] as const;
export const LEAD_SOURCE_OPTS: Opt[] = LEAD_SOURCES.map((s) => ({ value: s, label: s }));

export const PROJECT_STATUSES = [
  "PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT", "EXECUTION", "QUALITY_CHECK",
  "SNAGGING", "HANDOVER", "COMPLETED", "ON_HOLD", "CANCELLED",
] as const;
export const PROJECT_STATUS_OPTS = opts(PROJECT_STATUSES);

export const BOQ_CATEGORIES = [
  "CIVIL", "CARPENTRY", "ELECTRICAL", "PLUMBING", "PAINTING", "FALSE_CEILING", "FLOORING", "FURNITURE",
  "GLASS", "HARDWARE", "LIGHTING", "HVAC", "FABRICATION", "DECOR", "FIXTURES", "OTHER",
] as const;
export const BOQ_CATEGORY_OPTS = opts(BOQ_CATEGORIES);

export const TASK_STATUS_OPTS = opts(["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED"]);
export const TICKET_STATUS_OPTS = opts(["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]);
export const PAYMENT_METHOD_OPTS = opts(["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD", "OTHER"]);
export const EXPENSE_CATEGORY_OPTS = opts(["PROJECT", "OFFICE", "TRAVEL", "PETTY_CASH", "MATERIAL", "LABOUR", "VENDOR", "MISC"]);
export const WORKER_TRADE_OPTS = opts(["CARPENTER", "ELECTRICIAN", "PLUMBER", "PAINTER", "CIVIL", "FABRICATOR", "HELPER", "INSTALLER", "FALSE_CEILING", "OTHER"]);
export const UNIT_OPTS: Opt[] = ["nos", "sqft", "sqm", "rft", "rmt", "kg", "ltr", "bag", "box", "set", "lumpsum", "day", "hour"].map((u) => ({ value: u, label: u }));

export const DOCUMENT_TYPE_OPTS = opts(["CONTRACT", "DRAWING", "FLOOR_PLAN", "SITE_PHOTO", "INVOICE", "BILL", "GST", "PAN", "ID_PROOF", "PURCHASE", "VENDOR_DOC", "PROJECT_REPORT", "WARRANTY", "OTHER"]);
