"use server";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/lib/auth";
import { run, UserError } from "@/lib/action";
import { entityByKey, readTable, runImport, type ImportReport } from "@/lib/importer";

/** mode "check" validates only; mode "import" writes (all-or-nothing, and only when the check finds no errors). */
export async function importFile(fd: FormData) {
  return run<ImportReport>(async () => {
    const entity = entityByKey(String(fd.get("entity") ?? ""));
    if (!entity) throw new UserError("Choose what you are importing.");
    const c = await assertPerm(entity.perm);
    const file = fd.get("file");
    if (!(file instanceof File)) throw new UserError("Choose a CSV or Excel file.");
    const commit = fd.get("mode") === "import";
    const rows = await readTable(file);
    const report = await runImport(c, entity, rows, commit);
    if (commit && report.created > 0) for (const p of ["/crm/leads", "/crm/clients", "/procurement/vendors", "/inventory/materials", "/workforce/workers", "/hr/employees"]) revalidatePath(p);
    const msg = commit
      ? report.errors.length ? `Nothing imported – ${report.errors.length} row(s) need fixing` : `Imported ${report.created} ${entity.label.toLowerCase()}${report.duplicates ? ` (${report.duplicates} already existed and were skipped)` : ""}`
      : report.errors.length ? `${report.errors.length} problem(s) found` : `Looks good: ${report.valid} new, ${report.duplicates} already exist`;
    return { message: msg, data: report };
  });
}
