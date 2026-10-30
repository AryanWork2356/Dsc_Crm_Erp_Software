import "server-only";
import { db, type Tx } from "./db";
import { notifyRoles } from "./notify";

/**
 * Project closure (HR & Admin SOP): after handover these 15 documents/checks must be complete within 15 days,
 * then the closure report goes to the Commercial Director and Managing Director.
 * Four checks are made by the system from live records; the rest need the document (or the owner's confirmation).
 */
export type ClosureDef = { key: string; title: string; hint: string; docRequired: boolean; auto: boolean };

export const CLOSURE_ITEMS: ClosureDef[] = [
  { key: "handover_letter", title: "Client-signed project handover letter", hint: "Photo or PDF of the signed letter", docRequired: true, auto: false },
  { key: "vendor_bills", title: "All vendor bills certified", hint: "Checked automatically – every bill for this project is certified", docRequired: false, auto: true },
  { key: "snag_certificate", title: "Snag closure certificate", hint: "Signed by the client when all snags are closed", docRequired: true, auto: false },
  { key: "final_bill_docs", title: "Client final bill – approval and supporting documents", hint: "Approved final bill with measurements", docRequired: true, auto: false },
  { key: "final_measurements", title: "Final measurement records", hint: "Joint measurement sheets", docRequired: true, auto: false },
  { key: "warranty_certs", title: "Vendor warranty certificates", hint: "Collect from each vendor", docRequired: true, auto: false },
  { key: "testing_reports", title: "Testing and commissioning reports", hint: "Electrical, fire, HVAC, etc.", docRequired: true, auto: false },
  { key: "completion_photos", title: "Site completion photographs", hint: "Checked automatically – site photos exist for this project", docRequired: false, auto: true },
  { key: "launch_photos", title: "Project launch photographs", hint: "Photos from the launch / opening", docRequired: true, auto: false },
  { key: "material_recon", title: "Material reconciliation report", hint: "Material bought, used, returned and wasted", docRequired: true, auto: false },
  { key: "expense_closure", title: "Site expense closure confirmation", hint: "Checked automatically – no site expense is waiting for verification", docRequired: false, auto: true },
  { key: "supervisor_cert", title: "Coordinator performance certificate", hint: "Confirm the coordinator's performance review is done", docRequired: false, auto: false },
  { key: "pm_cert", title: "Project manager performance certificate", hint: "Confirm the project manager's review is done", docRequired: false, auto: false },
  { key: "lessons", title: "Project lessons-learned certificate", hint: "Checked automatically – the Project Director has written the lessons learned", docRequired: false, auto: true },
  { key: "final_checklist", title: "Final project closure checklist", hint: "Signed checklist covering everything above", docRequired: true, auto: false },
];

export const CLOSURE_DEADLINE_DAYS = 15; // closure report due this many days after handover

/** Creates the checklist when a project reaches handover/completion (no-op if it already exists). */
export async function ensureClosure(tx: Tx, companyId: string, projectId: string): Promise<{ created: boolean }> {
  const exists = await tx.projectClosure.findUnique({ where: { projectId }, select: { id: true } });
  if (exists) return { created: false };
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true, name: true } });
  await tx.projectClosure.create({
    data: { companyId, projectId, items: { create: CLOSURE_ITEMS.map((d, i) => ({ key: d.key, title: d.title, sortOrder: i, docRequired: d.docRequired, auto: d.auto })) } },
  });
  await notifyRoles(companyId, ["HR", "ADMIN"], { type: "GENERAL", title: `Closure checklist started: ${p.code} ${p.name}`, body: `${CLOSURE_ITEMS.length} items to complete within ${CLOSURE_DEADLINE_DAYS} days of handover.`, link: `/closure/${projectId}`, dedupeKey: `closure-start:${projectId}` }, tx);
  return { created: true };
}

export type AutoResult = { ok: boolean; detail: string };

/** The four system-checked items, from live records. */
export async function autoChecks(companyId: string, projectId: string, lessons: string | null): Promise<Record<string, AutoResult>> {
  const [uncertified, photos, openExpenses] = await Promise.all([
    db.vendorBill.count({ where: { companyId, projectId, certRequired: true, certifiedAt: null, status: { not: "CANCELLED" } } }),
    db.document.count({ where: { companyId, entityType: "PROJECT", entityId: projectId, type: "SITE_PHOTO", deletedAt: null } }),
    db.expense.count({ where: { companyId, projectId, approved: false, rejectedAt: null } }),
  ]);
  return {
    vendor_bills: { ok: uncertified === 0, detail: uncertified === 0 ? "All bills certified" : `${uncertified} bill(s) still need certification` },
    completion_photos: { ok: photos > 0, detail: photos > 0 ? `${photos} site photo(s) on file` : "No site photos yet" },
    expense_closure: { ok: openExpenses === 0, detail: openExpenses === 0 ? "No expense waiting" : `${openExpenses} expense(s) waiting for verification` },
    lessons: { ok: (lessons ?? "").trim().length >= 10, detail: (lessons ?? "").trim().length >= 10 ? "Written" : "Not written yet" },
  };
}

export type ClosureView = {
  closure: NonNullable<Awaited<ReturnType<typeof db.projectClosure.findUnique>>>;
  items: { id: string; key: string; title: string; hint: string; docRequired: boolean; auto: boolean; done: boolean; effectiveDone: boolean; detail: string | null; note: string | null; docId: string | null; doneAt: Date | null; doneById: string | null }[];
  done: number;
  total: number;
  missing: string[];
};

/** The checklist as people should see it: manual items from their record, system items from live checks. */
export async function loadClosure(companyId: string, projectId: string): Promise<ClosureView | null> {
  const closure = await db.projectClosure.findFirst({ where: { companyId, projectId }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!closure) return null;
  const auto = await autoChecks(companyId, projectId, closure.lessonsLearned);
  const hint = new Map(CLOSURE_ITEMS.map((d) => [d.key, d.hint]));
  const items = closure.items.map((i) => {
    const a = i.auto ? auto[i.key] : undefined;
    return { id: i.id, key: i.key, title: i.title, hint: hint.get(i.key) ?? "", docRequired: i.docRequired, auto: i.auto, done: i.done, effectiveDone: a ? a.ok : i.done, detail: a?.detail ?? null, note: i.note, docId: i.docId, doneAt: i.doneAt, doneById: i.doneById };
  });
  const { items: _items, ...head } = closure;
  return { closure: head, items, done: items.filter((i) => i.effectiveDone).length, total: items.length, missing: items.filter((i) => !i.effectiveDone).map((i) => i.title) };
}
