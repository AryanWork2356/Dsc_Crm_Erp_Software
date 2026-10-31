"use client";
import * as React from "react";
import { KeyRound, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { applyStaffLogins, previewStaffLogins } from "../actions";

type Plan = { userId: string; name: string; oldId: string; newId: string; oldRoleLabel: string; newRoleLabel: string };
type Issued = { name: string; role: string; loginId: string; password: string };

/**
 * One press gives every staff member their DSC role, a login ID like aryan.s@dsc and a 4-digit password.
 * Step 1 shows who gets what (nothing changes). Step 2 does it and shows the passwords ONCE, to download or print.
 */
export function StaffLogins() {
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [plan, setPlan] = React.useState<Plan[] | null>(null);
  const [issued, setIssued] = React.useState<Issued[] | null>(null);

  const preview = () => start(async () => {
    const r = await previewStaffLogins();
    if (r.ok) setPlan((r.data as { rows: Plan[] }).rows); else toast.error(r.error);
  });
  const apply = () => start(async () => {
    if (!window.confirm("Give everyone in this list the new role, login ID and a new password now? Their old passwords stop working.")) return;
    const r = await applyStaffLogins();
    if (r.ok) { setIssued((r.data as { rows: Issued[] }).rows); setPlan(null); toast.success(r.message ?? "Done"); } else toast.error(r.error);
  });
  const download = () => {
    if (!issued) return;
    const csv = ["Name,Role,Login ID,Password", ...issued.map((x) => [x.name, x.role, x.loginId, `="${x.password}"`].map((v) => `"${v.replace(/"/g, '""')}"`).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `DSC_Staff_Logins_CONFIDENTIAL_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <Card className="mb-5 border-brand-200">
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Set up staff logins</CardTitle></CardHeader>
      <CardBody className="space-y-3 text-sm">
        {!plan && !issued && (
          <>
            <p className="text-slate-600">Gives every staff member their role (Directors, Admins, HR, Designer, Accounts; everyone else Project Coordinator), a login ID like <b>aryan.s@dsc</b> and a new 4-digit password. You see the list first; nothing changes until you confirm.</p>
            <Button size="sm" variant="secondary" onClick={preview} loading={pending}>Show who gets what</Button>
          </>
        )}
        {plan && (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs rt">
                <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role now</th><th className="px-3 py-2">New role</th><th className="px-3 py-2">Login now</th><th className="px-3 py-2">New login ID</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.map((p) => (
                    <tr key={p.userId}><td className="px-3 py-1.5 font-medium text-slate-900">{p.name}</td><td className="px-3 py-1.5 text-slate-500">{p.oldRoleLabel}</td><td className={p.oldRoleLabel !== p.newRoleLabel ? "px-3 py-1.5 font-semibold text-brand-800" : "px-3 py-1.5"}>{p.newRoleLabel}</td><td className="px-3 py-1.5 text-slate-500">{p.oldId}</td><td className="px-3 py-1.5 font-semibold">{p.newId}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-slate-600">If a role is wrong, change it after this with Edit. Test logins, clients and vendors are not touched.</p>
            <div className="flex gap-2"><Button size="sm" onClick={apply} loading={pending}>Yes, set these logins now</Button><Button size="sm" variant="ghost" onClick={() => setPlan(null)}>Cancel</Button></div>
          </>
        )}
        {issued && (
          <>
            <p className="font-semibold text-red-700">Download or print this list now. The passwords are shown only this once.</p>
            <div className="flex gap-2"><Button size="sm" onClick={download}><Download className="h-4 w-4" /> Download list</Button><Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button></div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm rt">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Login ID</th><th className="px-3 py-2">Password</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{issued.map((x) => <tr key={x.loginId}><td className="px-3 py-1.5">{x.name}</td><td className="px-3 py-1.5">{x.role}</td><td className="px-3 py-1.5 font-semibold">{x.loginId}</td><td className="tabular px-3 py-1.5 font-mono text-base font-semibold">{x.password}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
