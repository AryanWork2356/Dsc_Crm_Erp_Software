import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "@/components/forms/action-button";
import { runAutomationsNow } from "./actions";

export const metadata = { title: "Automation" };

const LABELS: Record<string, string> = {
  quotationsExpired: "Quotations marked expired", invoicesOverdue: "Overdue invoices", invoicesDueSoon: "Invoices due in the next 3 days", whatsappReminders: "WhatsApp payment reminders sent",
  followUpUsersNotified: "Salespeople reminded of follow-ups", latePurchaseOrders: "Purchase orders with late delivery", projectDeadlines: "Projects near / past deadline",
  taskUsersNotified: "People reminded of tasks", vendorBillsDue: "Vendor bills due or overdue", documentsExpiring: "Documents expiring", unassignedLeads: "Leads without an owner",
};

export default async function AutomationPage() {
  const c = await requirePerm("settings:manage");
  const s = await db.companySettings.findUnique({ where: { companyId: c.companyId } });
  const prefs = (s?.notificationPrefs && typeof s.notificationPrefs === "object" ? s.notificationPrefs : {}) as { lastDailyRun?: string; lastDailyResult?: Record<string, number> };
  return (
    <>
      <PageHeader title="Automation" subtitle="Reminders and checks that run by themselves every day." actions={<ActionButton action={runAutomationsNow}>Run now</ActionButton>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>What runs daily</CardTitle></CardHeader><CardBody className="space-y-2 text-sm text-slate-700">
          <p>• Quotations past their validity are marked <b>Expired</b>.</p><p>• Unpaid invoices past their due date become <b>Overdue</b> and Accounts is alerted; clients get a WhatsApp reminder if automatic messages are on.</p>
          <p>• Salespeople get their <b>follow-ups due</b>. Project managers get <b>deadline</b> alerts; people get <b>task</b> reminders.</p>
          <p>• Procurement is alerted about <b>late deliveries</b>; Accounts about <b>vendor bills</b> due.</p><p>• Expiring <b>documents</b> and <b>unassigned leads</b> are flagged.</p>
          <p className="border-t border-slate-100 pt-2 text-xs text-slate-500">It runs automatically the first time anyone opens the dashboard each day. For a fixed time, have your server call <code>POST /api/cron/daily</code> with the <code>CRON_SECRET</code>. Running it again never duplicates a notification.</p>
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Last run</CardTitle></CardHeader><CardBody>
          {!prefs.lastDailyRun ? <p className="text-sm text-slate-500">Hasn&apos;t run yet.</p> : (
            <><p className="mb-3 text-sm text-slate-600">{formatDateTime(prefs.lastDailyRun)}</p>
              <ul className="space-y-1.5 text-sm">{Object.entries(prefs.lastDailyResult ?? {}).map(([k, v]) => <li key={k} className="flex justify-between"><span className="text-slate-600">{LABELS[k] ?? k}</span><span className="tabular font-medium">{v}</span></li>)}</ul></>
          )}
        </CardBody></Card>
      </div>
    </>
  );
}
