import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiModel, aiOn, aiProvider, canControlAi } from "@/lib/ai";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { AiToggle } from "./toggle";

export const metadata = { title: "AI helper" };

const FEATURES = [
  ["Reading bills", "Photo, PDF, Excel or handwritten: Vendor Bills and Expenses fill themselves for checking."],
  ["Say what you need", "Purchase request: speak or type the material and the items fill in."],
  ["Reading papers", "Delivery challans, client purchase orders and BOQ scans or PDFs."],
  ["Spelling fix ✨ and English for notes", "On every notes box, and on site reports for directors."],
  ["Voice notes as English text", "A button under each recorded voice note."],
  ["Blurry or dark photo warning", "On site photos and bill photos."],
  ["Ask the app", "Directors and admins ask questions; answers in English or Hindi, with Listen."],
  ["Evening summary", "One message to the directors about all sites."],
];

export default async function AiSettingsPage() {
  const c = await requireCtx();
  if (!canControlAi(c)) redirect("/forbidden");
  const s = await db.companySettings.findUnique({ where: { companyId: c.companyId }, select: { aiEnabled: true } });
  const on = s?.aiEnabled !== false;
  const hasKey = aiOn();
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="AI helper" subtitle="One switch for every AI feature. Only Aryan Shetty and Rupesh Sharma see this page." />
      <Card><CardBody><AiToggle on={on} hasKey={hasKey} /></CardBody></Card>
      <Card>
        <CardHeader><CardTitle>What this switch controls</CardTitle></CardHeader>
        <ul className="divide-y divide-slate-100">
          {FEATURES.map(([t, d]) => <li key={t} className="px-5 py-3"><p className="text-sm font-medium text-slate-900">{t}</p><p className="text-xs text-slate-500">{d}</p></li>)}
        </ul>
      </Card>
      <Card>
        <CardHeader><CardTitle>Connection</CardTitle></CardHeader>
        <CardBody className="space-y-1 text-sm text-slate-700">
          <p>AI service: <b>{hasKey ? (aiProvider() === "gemini" ? "Google Gemini" : "Claude") : "not connected (no key set)"}</b></p>
          {hasKey && <p>Main model: <b>{aiModel("careful")}</b> · quick jobs: <b>{aiModel("fast")}</b></p>}
          <p className="text-xs text-slate-500">The key itself is kept in Vercel (Settings → Environment Variables) and is never shown here.</p>
        </CardBody>
      </Card>
    </div>
  );
}
