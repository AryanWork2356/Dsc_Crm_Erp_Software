import { requirePerm } from "@/lib/auth";
import { loadWaConfig, isConnected, TEMPLATES } from "@/lib/whatsapp";
import { PageHeader, Alert } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { saveWhatsAppConfig } from "../../whatsapp/actions";

export const metadata = { title: "WhatsApp Settings" };

export default async function WhatsAppSettings() {
  const c = await requirePerm("settings:manage");
  const cfg = await loadWaConfig(c.companyId);
  const base = process.env.APP_URL ?? "https://your-domain";
  const ok = isConnected(cfg);
  return (
    <>
      <PageHeader title="WhatsApp connection" subtitle="Uses Meta's official WhatsApp Business Cloud API – no unofficial tools." actions={<FormDialog title="WhatsApp Cloud API" description="From Meta for Developers → your app → WhatsApp → API setup. Secrets are stored encrypted." wide trigger={<Button>{ok ? "Edit connection" : "Connect WhatsApp"}</Button>} fields={[
        { name: "enabled", label: "Turn WhatsApp on", type: "checkbox", defaultValue: cfg.enabled },
        { name: "autoMessages", label: "Send automatic messages (lead acknowledgement, payment reminders…)", type: "checkbox", defaultValue: cfg.autoMessages },
        { name: "phoneNumberId", label: "Phone Number ID", defaultValue: cfg.phoneNumberId, full: true, hint: "Digits only" },
        { name: "accessToken", label: "Permanent access token", type: "password", hint: cfg.accessToken ? "Saved – leave blank to keep it" : "Create a permanent System User token in Meta Business settings", full: true },
        { name: "appSecret", label: "App secret", type: "password", hint: cfg.appSecret ? "Saved – leave blank to keep it" : "Used to verify that webhook calls really come from Meta", full: true },
        { name: "verifyToken", label: "Webhook verify token", defaultValue: cfg.verifyToken, full: true, hint: "Any text; paste the same into Meta. Leave blank to generate one" },
      ]} action={saveWhatsAppConfig} /> } />
      <div className="mb-5">{ok ? <Alert tone="good">Connected. Messages you send from the WhatsApp inbox are delivered through Meta.</Alert> : <Alert tone="warn">Not connected. Messages are saved in the inbox but are <b>not delivered</b> until the details below are added.</Alert>}</div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Status</CardTitle></CardHeader><CardBody className="space-y-2 text-sm">
          <p>WhatsApp: {cfg.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</p><p>Phone Number ID: {cfg.phoneNumberId || <span className="text-slate-400">not set</span>}</p>
          <p>Access token: {cfg.accessToken ? <Badge tone="green">saved (encrypted)</Badge> : <Badge tone="amber">missing</Badge>}</p><p>App secret: {cfg.appSecret ? <Badge tone="green">saved (encrypted)</Badge> : <Badge tone="amber">missing</Badge>}</p>
          <p>Automatic messages: {cfg.autoMessages ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</p>
        </CardBody></Card>
        <Card><CardHeader><CardTitle>Webhook (paste into Meta)</CardTitle></CardHeader><CardBody className="space-y-3 text-sm">
          <div><p className="text-xs uppercase tracking-wide text-slate-500">Callback URL</p><code className="block break-all rounded bg-slate-100 px-2 py-1.5 text-xs">{base}/api/whatsapp/webhook</code></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">Verify token</p><code className="block break-all rounded bg-slate-100 px-2 py-1.5 text-xs">{cfg.verifyToken || "(save the connection to generate one)"}</code></div>
          <p className="text-xs text-slate-500">Subscribe to the <b>messages</b> field. The URL must be public (HTTPS) – use your deployed domain.</p>
        </CardBody></Card>
      </div>
      <Card className="mt-5"><CardHeader><CardTitle>Message templates</CardTitle></CardHeader><CardBody className="space-y-3 text-sm">
        {Object.values(TEMPLATES).map((t) => <div key={t.label}><p className="font-medium text-slate-900">{t.label}</p><p className="text-slate-600">{t.body}</p></div>)}
        <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">WhatsApp allows free-form replies only within 24 hours of the customer&apos;s last message. To start a conversation after that, Meta requires pre-approved template messages – submit these texts in Meta&apos;s Message Templates section.</p>
      </CardBody></Card>
    </>
  );
}
