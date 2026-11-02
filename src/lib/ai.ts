import "server-only";
import { GoogleGenAI, ApiError } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";

/**
 * One place where the app talks to an AI, so the provider can be changed with a setting:
 *   AI_PROVIDER = "gemini" | "claude"   (default: Gemini when GEMINI_API_KEY is set, else Claude when ANTHROPIC_API_KEY is set)
 *   GEMINI_API_KEY, GEMINI_MODEL (careful jobs), GEMINI_FAST_MODEL (simple jobs)
 *   ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_FAST_MODEL
 * With no key at all every AI feature is simply off and the app works as before.
 *
 * The AI only ever SUGGESTS: callers fill boxes or show text for a person to check. Nothing is saved because of it.
 */

export type AiProvider = "gemini" | "claude";
export type AiQuality = "careful" | "fast";
export type AiPart = { text: string } | { image: Buffer; mime: string } | { pdf: Buffer };

export class AiError extends Error {}

export function aiProvider(): AiProvider | null {
  const want = process.env.AI_PROVIDER;
  if (want === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (want === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}
export const aiOn = () => aiProvider() !== null;

export function aiModel(q: AiQuality): string {
  if (aiProvider() === "gemini") return q === "careful" ? process.env.GEMINI_MODEL || "gemini-3.8-flash" : process.env.GEMINI_FAST_MODEL || "gemini-3.5-flash-lite";
  return q === "careful" ? process.env.CLAUDE_MODEL || process.env.BILL_MODEL || "claude-opus-5-5" : process.env.CLAUDE_FAST_MODEL || "claude-haiku-5-5";
}

const BUSY = "The AI helper is busy right now. Please try again in a minute, or fill it in by hand.";
const SETUP = "The AI helper is not set up correctly. Please tell the Admin; you can still fill it in by hand.";
const FAILED = "The AI helper did not work this time. You can fill it in by hand.";

let gemini: GoogleGenAI | null = null;
async function askGemini(o: { system: string; parts: AiPart[]; schema?: object; quality: AiQuality }): Promise<string> {
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const input = o.parts.map((p) =>
    "text" in p ? { type: "text" as const, text: p.text }
    : "image" in p ? { type: "image" as const, data: p.image.toString("base64"), mime_type: p.mime }
    : { type: "document" as const, data: p.pdf.toString("base64"), mime_type: "application/pdf" });
  try {
    const r = await gemini.interactions.create({
      model: aiModel(o.quality),
      input: input as never,
      system_instruction: o.system,
      store: false, // do not keep our company's data on Google's side
      generation_config: { thinking_level: o.quality === "careful" ? "low" : "minimal" },
      ...(o.schema ? { response_format: { type: "text", mime_type: "application/json", schema: o.schema as Record<string, unknown> } } : {}),
    } as never);
    const text = (r as { output_text?: string }).output_text;
    if (!text) throw new AiError(FAILED);
    return text;
  } catch (e) {
    if (e instanceof AiError) throw e;
    console.error("[ai] gemini call failed:", aiModel(o.quality), e instanceof ApiError ? `${e.status} ${e.message}`.slice(0, 600) : String(e).slice(0, 600));
    if (e instanceof ApiError) {
      if (e.status === 429) throw new AiError(BUSY);
      if (e.status === 401 || e.status === 403) throw new AiError(SETUP);
      if (e.status === 400) throw new AiError("This could not be read. Try a clearer photo or a smaller file.");
    }
    throw new AiError(FAILED);
  }
}

let claude: Anthropic | null = null;
async function askClaude(o: { system: string; parts: AiPart[]; schema?: object; quality: AiQuality }): Promise<string> {
  claude ??= new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const content = o.parts.map((p) =>
    "text" in p ? ({ type: "text", text: p.text } as const)
    : "image" in p ? ({ type: "image", source: { type: "base64", media_type: p.mime as "image/jpeg" | "image/png" | "image/webp", data: p.image.toString("base64") } } as const)
    : ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.pdf.toString("base64") } } as const));
  try {
    const res = await claude.messages.create({
      model: aiModel(o.quality),
      max_tokens: 4000,
      system: o.system,
      output_config: { effort: o.quality === "careful" ? "low" : "low", ...(o.schema ? { format: { type: "json_schema", schema: o.schema as Record<string, unknown> } } : {}) },
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal") throw new AiError(FAILED);
    const t = res.content.find((b) => b.type === "text");
    if (!t || t.type !== "text") throw new AiError(FAILED);
    return t.text;
  } catch (e) {
    if (e instanceof AiError) throw e;
    console.error("[ai] claude call failed:", aiModel(o.quality), String(e).slice(0, 600));
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError(SETUP);
    if (e instanceof Anthropic.RateLimitError) throw new AiError(BUSY);
    if (e instanceof Anthropic.BadRequestError) throw new AiError("This could not be read. Try a clearer photo or a smaller file.");
    throw new AiError(FAILED);
  }
}

/** Plain text answer (summaries, translations, answers to questions). */
export async function aiText(o: { system: string; parts: AiPart[]; quality?: AiQuality }): Promise<string> {
  const p = aiProvider();
  if (!p) throw new AiError("The AI helper is switched off.");
  const q = o.quality ?? "fast";
  return (p === "gemini" ? askGemini({ ...o, quality: q }) : askClaude({ ...o, quality: q })).then((t) => t.trim());
}

/** An answer in a fixed JSON shape (filling a form). The caller still checks every value before showing it. */
export async function aiJson(o: { system: string; parts: AiPart[]; schema: object; quality?: AiQuality }): Promise<unknown> {
  const p = aiProvider();
  if (!p) throw new AiError("The AI helper is switched off.");
  const q = o.quality ?? "fast";
  const text = await (p === "gemini" ? askGemini({ ...o, quality: q }) : askClaude({ ...o, quality: q }));
  try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new AiError("The answer could not be understood. Please fill it in by hand."); }
}
