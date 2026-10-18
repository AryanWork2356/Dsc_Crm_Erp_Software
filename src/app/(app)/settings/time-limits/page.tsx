import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_TIMES } from "@/lib/site-reports";
import { getLimits, hoursLabel, RULES } from "@/lib/time-limits";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormDialog, type FieldDef } from "@/components/forms/form-dialog";
import { saveTimeLimits } from "./actions";

export const metadata = { title: "Time limits settings" };

export default async function TimeLimitSettingsPage() {
  const c = await requirePerm("settings:manage");
  const [limits, s] = await Promise.all([getLimits(c.companyId), db.companySettings.findUnique({ where: { companyId: c.companyId } })]);
  const t = { reportMorningDue: s?.reportMorningDue ?? DEFAULT_TIMES.reportMorningDue, reportMorningDueOutstation: s?.reportMorningDueOutstation ?? DEFAULT_TIMES.reportMorningDueOutstation, reportEveningDue: s?.reportEveningDue ?? DEFAULT_TIMES.reportEveningDue };

  const fields: FieldDef[] = [
    { name: "reportMorningDue", label: "Morning update – city sites (by)", type: "time", defaultValue: t.reportMorningDue, required: true },
    { name: "reportMorningDueOutstation", label: "Morning update – outstation sites (by)", type: "time", defaultValue: t.reportMorningDueOutstation, required: true },
    { name: "reportEveningDue", label: "Evening report (by)", type: "time", defaultValue: t.reportEveningDue, required: true },
    { name: "materialNoticeDays", label: "Material must be requested this many days ahead", type: "number", defaultValue: s?.materialNoticeDays ?? 2, hint: "SOP: 2–3 days" },
    { name: "leaveNoticeDays", label: "Regular leave notice (days)", type: "number", defaultValue: s?.leaveNoticeDays ?? 15 },
    { name: "longLeaveNoticeDays", label: "Long leave notice (days)", type: "number", defaultValue: s?.longLeaveNoticeDays ?? 90 },
    { name: "leaveYearlyCap", label: "Yearly leave limit (days)", type: "number", defaultValue: s?.leaveYearlyCap ?? 30, hint: "More needs the Managing Director's written approval" },
    ...RULES.map<FieldDef>((r) => ({ name: `rule_${r.key}`, label: `${r.title} (hours)`, type: "number", defaultValue: limits[r.key], hint: `SOP default: ${hoursLabel(r.defaultHours)}`, full: true })),
  ];

  return (
    <>
      <PageHeader
        title="Time limits"
        subtitle="How long each step may wait before the owner, then the manager, then the directors are told."
        actions={<FormDialog title="Change time limits" description="Times are India time (24-hour). Limits are in hours – 48 means two days." wide trigger={<Button>Change</Button>} fields={fields} action={saveTimeLimits} />}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Site report deadlines</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm text-slate-700">
            <p className="flex justify-between"><span>Morning update – city sites</span><b>{t.reportMorningDue}</b></p>
            <p className="flex justify-between"><span>Morning update – outstation sites</span><b>{t.reportMorningDueOutstation}</b></p>
            <p className="flex justify-between"><span>Evening report</span><b>{t.reportEveningDue}</b></p>
            <p className="border-t border-slate-100 pt-2 text-xs text-slate-500">If a report is missing: the supervisor is reminded, after 1 hour the project manager, after 3 hours the owner and management.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>Notice rules</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm text-slate-700">
            <p className="flex justify-between"><span>Material requested ahead</span><b>{s?.materialNoticeDays ?? 2} days</b></p>
            <p className="flex justify-between"><span>Regular leave notice</span><b>{s?.leaveNoticeDays ?? 15} days</b></p>
            <p className="flex justify-between"><span>Long leave notice</span><b>{s?.longLeaveNoticeDays ?? 90} days</b></p>
            <p className="flex justify-between"><span>Yearly leave limit</span><b>{s?.leaveYearlyCap ?? 30} days</b></p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>Step time limits</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm text-slate-700">
            {RULES.map((r) => <p key={r.key} className="flex justify-between gap-3"><span>{r.title}</span><b className="shrink-0">{hoursLabel(limits[r.key])}</b></p>)}
            <p className="border-t border-slate-100 pt-2 text-xs text-slate-500">Escalation: owner is told when the limit passes, the manager half a limit later (at least 12 hours), the directors after a full limit (at least 2 days).</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
