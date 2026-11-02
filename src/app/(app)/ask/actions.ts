"use server";
import { z } from "zod";
import { getCtx } from "@/lib/auth";
import { run, UserError } from "@/lib/action";
import { AiError, aiActive } from "@/lib/ai";
import { ASK_ROLES, askApp } from "@/lib/ask";

const turns = z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(6000) })).min(1).max(30);

/** One question to "Ask the app". Read-only: it answers from the records the person may see and changes nothing. */
export async function ask(history: unknown) {
  return run(async () => {
    const c = await getCtx();
    if (!c || !ASK_ROLES.includes(c.role)) throw new UserError("Ask the app is for directors and admins.");
    if (!(await aiActive(c.companyId))) throw new UserError("The AI helper is not switched on.");
    const h = turns.safeParse(history);
    if (!h.success || h.data.at(-1)?.role !== "user" || !h.data.at(-1)?.text.trim()) throw new UserError("Type or say a question first.");
    try {
      return { message: "Answered", data: { answer: await askApp(c, h.data) } };
    } catch (e) {
      if (e instanceof AiError) throw new UserError(e.message.replace("fill it in by hand", "look it up in the app"));
      throw e;
    }
  });
}
