import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { aiActive } from "@/lib/ai";
import { ASK_ROLES } from "@/lib/ask";
import { PageHeader, Alert } from "@/components/ui/page";
import { AskChat } from "./ask-chat";

export const metadata = { title: "Ask the app" };

export default async function AskPage() {
  const c = await requireCtx();
  if (!ASK_ROLES.includes(c.role)) redirect("/forbidden");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Ask the app" subtitle="Ask about today's sites, delays, material or money – in English or Hindi. Press Listen to hear the answer." />
      {(await aiActive(c.companyId)) ? <AskChat /> : <Alert tone="warn">The AI helper is switched off.</Alert>}
    </div>
  );
}
