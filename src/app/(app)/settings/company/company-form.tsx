"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { saveCompanySettings } from "../actions";

type V = Record<string, string | number>;

export function CompanyForm({ values, canEdit }: { values: V; canEdit: boolean }) {
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const toast = useToast();
  const router = useRouter();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    start(async () => {
      const r = await saveCompanySettings(fd);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  const f = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <Field label={label} error={errors[name]} hint={hint} required={props.required}>
      <Input name={name} defaultValue={values[name]} disabled={!canEdit} {...props} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Company details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {f("legalName", "Company name", { required: true })}
          {f("website", "Website")}
          <Field label="Address" error={errors.address} className="sm:col-span-2">
            <Textarea name="address" defaultValue={values.address} disabled={!canEdit} />
          </Field>
          {f("phone", "Phone")}
          {f("email", "Email", { type: "email" })}
          {f("gstin", "GSTIN", {}, "15-character GST number")}
          {f("pan", "PAN")}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Bank details (shown on invoices)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {f("bankName", "Bank name")}
          {f("bankBranch", "Branch")}
          {f("bankAccountNo", "Account number")}
          {f("bankIfsc", "IFSC")}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Numbering &amp; tax</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          {f("quotationPrefix", "Quotation prefix", { required: true })}
          {f("poPrefix", "PO prefix", { required: true })}
          {f("invoicePrefix", "Invoice prefix", { required: true })}
          {f("defaultTaxPercent", "Default GST %", { type: "number", step: "0.01" })}
        </div>
      </section>
      <section>
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Approval limits</h2>
        <p className="mb-3 text-sm text-slate-500">
          Purchases and expenses up to Level 1 are approved by the Project Manager, up to Level 2 by Management, and above that by the Owner.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {f("approvalLevel1", "Level 1 limit (₹)", { type: "number", step: "1" })}
          {f("approvalLevel2", "Level 2 limit (₹)", { type: "number", step: "1" })}
        </div>
      </section>
      {canEdit && (
        <div className="flex justify-end border-t border-slate-100 pt-4">
          <Button type="submit" loading={pending}>
            Save settings
          </Button>
        </div>
      )}
    </form>
  );
}
