import { getCtx } from "@/lib/auth";
import { scheduleTemplate } from "@/lib/schedule-template";

/** The blank schedule file, for people who may add tasks. */
export async function GET() {
  const c = await getCtx();
  if (!c) return new Response("Sign in required", { status: 401 });
  if (!c.can("tasks:create")) return new Response("Not allowed", { status: 403 });
  return new Response(new Uint8Array(await scheduleTemplate()), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="DSC_Schedule_Template.xlsx"', "Cache-Control": "no-store" },
  });
}
