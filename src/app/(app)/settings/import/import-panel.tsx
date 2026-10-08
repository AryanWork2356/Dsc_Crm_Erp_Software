"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action";
import type { ImportReport } from "@/lib/importer";

type Ent = { key: string; label: string; columns: { header: string; required?: boolean; hint?: string }[] };

export function ImportPanel({ entities, action, initial }: { entities: Ent[]; action: (fd: FormData) => Promise<ActionResult<ImportReport>>; initial?: string }) {
  const toast = useToast();
  const router = useRouter();
  const [entity, setEntity] = React.useState(initial && entities.some((e) => e.key === initial) ? initial : entities[0]?.key ?? "");
  const [report, setReport] = React.useState<(ImportReport & { mode: "check" | "import" }) | null>(null);
  const [pending, start] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  const ent = entities.find((e) => e.key === entity);

  function submit(mode: "check" | "import") {
    const fd = new FormData(formRef.current!);
    fd.set("mode", mode);
    fd.set("entity", entity);
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) { toast.error("Choose a file first."); return; }
    start(async () => {
      const r = await action(fd);
      if (!r.ok) { toast.error(r.error); return; }
      if (r.data) setReport({ ...r.data, mode });
      if (r.data?.errors.length) toast.error(r.message ?? "Problems found"); else toast.success(r.message ?? "Done");
      if (mode === "import") router.refresh();
    });
  }

  const ready = report?.mode === "check" && report.errors.length === 0 && report.valid > 0;
  return (
    <div className="space-y-5">
      <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="grid gap-4 sm:grid-cols-2">
        <Field label="What are you importing?"><Select value={entity} onChange={(e) => { setEntity(e.target.value); setReport(null); }}>{entities.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</Select></Field>
        <Field label="File (.csv or .xlsx)"><Input type="file" name="file" accept=".csv,.xlsx" className="h-auto py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1 file:text-sm file:font-medium file:text-brand-800" onChange={() => setReport(null)} /></Field>
      </form>
      {ent && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-900">Columns for {ent.label.toLowerCase()}</p><a className="font-medium text-brand-700 hover:underline" href={`/settings/import/template?entity=${ent.key}`} download>Download template</a></div>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">{ent.columns.map((c) => <li key={c.header}><b>{c.header}</b>{c.required && <span className="text-red-600"> *</span>}{c.hint && <span className="text-slate-500"> – {c.hint}</span>}</li>)}</ul>
          <p className="mt-2 text-xs text-slate-500">Rows that already exist (same GSTIN / phone / SKU / email) are skipped, never overwritten – it&apos;s safe to re-upload a file.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={pending} onClick={() => submit("check")}>1 · Check file</Button>
        <Button disabled={!ready || pending} onClick={() => submit("import")}>2 · Import {report?.valid ? `${report.valid} row(s)` : ""}</Button>
      </div>
      {report && (
        <div className={`rounded-lg border p-4 text-sm ${report.errors.length ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
          <p className="font-semibold text-slate-900">{report.mode === "import" && !report.errors.length ? `Imported ${report.created} record(s).` : report.errors.length ? "Fix these rows, then check the file again:" : "File is ready to import."}</p>
          <p className="mt-1 text-slate-700">{report.total} row(s) read · {report.valid} new · {report.duplicates} already exist · {report.errors.length} with problems</p>
          {report.errors.length > 0 && <ul className="mt-2 max-h-64 list-disc space-y-0.5 overflow-y-auto pl-5 text-red-800">{report.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
