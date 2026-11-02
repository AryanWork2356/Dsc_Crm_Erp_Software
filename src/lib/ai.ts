import "server-only";
import { GoogleGenAI, ApiError, ThinkingLevel } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";

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
export type AiPart = { text: string } | { image: Buffer; mime: string } | { pdf: Buffer } | { audio: Buffer; mime: string };
/** Longer jobs (a whole BOQ, a recording) may ask for more time and a bigger answer; everything else keeps the short limits. */
export type AiOpts = { tryMs?: number; totalMs?: number; maxTokens?: number; thinking?: "minimal" | "low" };

export class AiError extends Error {}

export function aiProvider(): AiProvider | null {
  const want = process.env.AI_PROVIDER;
  if (want === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (want === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}
/** An AI key is set (the technical part). Use `aiActive(companyId)` to decide whether a feature shows: it also checks the master switch. */
export const aiOn = () => aiProvider() !== null;

/**
 * Whether the AI helper is ON for this company: a key is set AND the master switch is on (Settings → AI helper).
 * Every AI feature (buttons, boxes, menu entries, alerts) must check this; with it off the app is exactly as it was before AI.
 */
export async function aiActive(companyId: string): Promise<boolean> {
  if (!aiOn()) return false;
  const s = await db.companySettings.findUnique({ where: { companyId }, select: { aiEnabled: true } });
  return s?.aiEnabled !== false;
}

/** The only people who may flip the master switch: the host and the managing director, by name. */
const SWITCH_PEOPLE = ["aryan shetty", "rupesh sharma"];
export const canControlAi = (c: { role: string; name: string }) => c.role === "OWNER" && SWITCH_PEOPLE.includes(c.name.replace(/\s+/g, " ").trim().toLowerCase());

export function aiModel(q: AiQuality): string {
  if (aiProvider() === "gemini") return q === "careful" ? process.env.GEMINI_MODEL || "gemini-3.8-flash" : process.env.GEMINI_FAST_MODEL || "gemini-3.5-flash-lite";
  return q === "careful" ? process.env.CLAUDE_MODEL || process.env.BILL_MODEL || "claude-opus-5-5" : process.env.CLAUDE_FAST_MODEL || "claude-haiku-5-5";
}

const BUSY = "The AI helper is busy right now. Please try again in a minute, or fill it in by hand.";
const SETUP = "The AI helper is not set up correctly. Please tell the Admin; you can still fill it in by hand.";
const FAILED = "The AI helper did not work this time. You can fill it in by hand.";

/** Longest we wait in all: a person is looking at a spinner, and the server stops the request at 60 seconds anyway. */
const AI_TIMEOUT_MS = 40_000;
/** One try with one model gets this long; if that model is busy or slow, the next one is tried. */
const TRY_MS = 17_000;
const SLOW = "The AI helper took too long this time. Please try again, or fill it in by hand.";

/** Google's models take turns being overloaded ("high demand", 503) – so each job has a list to fall back through, best first. */
export function geminiModels(q: AiQuality): string[] {
  const own = aiModel(q);
  const chain = q === "careful"
    ? [own, "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]
    : [own, "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
  return [...new Set(chain)];
}
const busyStatus = (e: unknown) => e instanceof ApiError && [429, 500, 502, 503, 504].includes(e.status);

let gemini: GoogleGenAI | null = null;
async function askGemini(o: { system: string; parts: AiPart[]; schema?: object; quality: AiQuality } & AiOpts): Promise<string> {
  const tryMs = o.tryMs ?? TRY_MS;
  const totalMs = o.totalMs ?? AI_TIMEOUT_MS;
  // the standard generateContent call (the newer "interactions" call waited without answering on the live site)
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: TRY_MS } });
  const parts = o.parts.map((p) =>
    "text" in p ? { text: p.text }
    : "image" in p ? { inlineData: { mimeType: p.mime, data: p.image.toString("base64") } }
    : "audio" in p ? { inlineData: { mimeType: p.mime, data: p.audio.toString("base64") } }
    : { inlineData: { mimeType: "application/pdf", data: p.pdf.toString("base64") } });
  const begun = Date.now();
  let last: unknown = null;
  for (const model of geminiModels(o.quality)) {
    if (Date.now() - begun > totalMs - Math.min(6_000, tryMs / 2)) break; // no time left for another try
    const started = Date.now();
    try {
      const call = gemini.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: o.system,
          httpOptions: { timeout: tryMs },
          ...(o.maxTokens ? { maxOutputTokens: o.maxTokens } : {}),
          // "thinking" is a setting of the newer models only; the older ones refuse it
          ...(/gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: (o.thinking ?? (o.quality === "careful" ? "low" : "minimal")) === "low" ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL } } : {}),
          ...(o.schema ? { responseMimeType: "application/json", responseJsonSchema: o.schema } : {}),
        },
      });
      const r = await Promise.race([call, new Promise<never>((_, no) => setTimeout(() => no(new AiError(SLOW)), tryMs + 1500))]);
      const text = r.text;
      console.log("[ai] gemini answered:", model, `${Date.now() - started} ms`);
      if (text) return text;
      last = new AiError(FAILED);
    } catch (e) {
      console.error("[ai] gemini call failed:", model, `${Date.now() - started} ms`, e instanceof ApiError ? `${e.status} ${e.message}`.slice(0, 300) : String(e).slice(0, 300));
      last = e;
      if (e instanceof AiError || busyStatus(e)) continue; // slow or busy: try the next model
      break; // a real refusal (bad key, unreadable file): another model will not help
    }
  }
  const e = last;
  if (e instanceof AiError) throw e;
  if (e instanceof ApiError) {
    if (busyStatus(e)) throw new AiError(BUSY);
    if (e.status === 401 || e.status === 403) throw new AiError(SETUP);
    if (e.status === 400) throw new AiError("This could not be read. Try a clearer photo or a smaller file.");
  }
  throw new AiError(FAILED);
}

let claude: Anthropic | null = null;
async function askClaude(o: { system: string; parts: AiPart[]; schema?: object; quality: AiQuality } & AiOpts): Promise<string> {
  if (o.parts.some((p) => "audio" in p)) throw new AiError("Turning a recording into text needs Gemini. Please ask the Admin.");
  claude ??= new Anthropic({ timeout: o.totalMs ?? AI_TIMEOUT_MS, maxRetries: 0 });
  const content = o.parts.map((p) =>
    "audio" in p ? ({ type: "text", text: "" } as const)
    : "text" in p ? ({ type: "text", text: p.text } as const)
    : "image" in p ? ({ type: "image", source: { type: "base64", media_type: p.mime as "image/jpeg" | "image/png" | "image/webp", data: p.image.toString("base64") } } as const)
    : ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.pdf.toString("base64") } } as const));
  try {
    const res = await claude.messages.create({
      model: aiModel(o.quality),
      max_tokens: o.maxTokens ?? 4000,
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
export async function aiText(o: { system: string; parts: AiPart[]; quality?: AiQuality } & AiOpts): Promise<string> {
  const p = aiProvider();
  if (!p) throw new AiError("The AI helper is switched off.");
  const q = o.quality ?? "fast";
  return (p === "gemini" ? askGemini({ ...o, quality: q }) : askClaude({ ...o, quality: q })).then((t) => t.trim());
}

/** An answer in a fixed JSON shape (filling a form). The caller still checks every value before showing it. */
export async function aiJson(o: { system: string; parts: AiPart[]; schema: object; quality?: AiQuality } & AiOpts): Promise<unknown> {
  const p = aiProvider();
  if (!p) throw new AiError("The AI helper is switched off.");
  const q = o.quality ?? "fast";
  const text = await (p === "gemini" ? askGemini({ ...o, quality: q }) : askClaude({ ...o, quality: q }));
  try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new AiError("The answer could not be understood. Please fill it in by hand."); }
}
