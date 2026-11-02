import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// a pretend Google: the models named in `busy` answer "high demand" (503), a model in `refuse` says the key is wrong
const state = { busy: new Set<string>(), refuse: new Set<string>(), asked: [] as string[] };
vi.mock("@google/genai", () => {
  class ApiError extends Error { status: number; constructor(o: { message: string; status: number }) { super(o.message); this.status = o.status; } }
  class GoogleGenAI {
    models = {
      generateContent: async (p: { model: string }) => {
        state.asked.push(p.model);
        if (state.busy.has(p.model)) throw new ApiError({ message: "high demand", status: 503 });
        if (state.refuse.has(p.model)) throw new ApiError({ message: "bad key", status: 403 });
        return { text: `answer from ${p.model}` };
      },
    };
  }
  return { GoogleGenAI, ApiError, ThinkingLevel: { LOW: "LOW", MINIMAL: "MINIMAL" } };
});
import { aiText, geminiModels } from "@/lib/ai";

beforeEach(() => { state.busy.clear(); state.refuse.clear(); state.asked = []; process.env.GEMINI_API_KEY = "g"; delete process.env.ANTHROPIC_API_KEY; delete process.env.AI_PROVIDER; });
afterEach(() => { delete process.env.GEMINI_API_KEY; });

describe("Gemini fallback", () => {
  it("each job has a list of models, the best first, no repeats", () => {
    expect(geminiModels("careful")[0]).toBe("gemini-3.8-flash");
    expect(geminiModels("careful").length).toBeGreaterThanOrEqual(3);
    expect(new Set(geminiModels("fast")).size).toBe(geminiModels("fast").length);
  });

  it("when the best model is busy the next one answers", async () => {
    state.busy.add("gemini-3.8-flash");
    const t = await aiText({ quality: "careful", system: "s", parts: [{ text: "hi" }] });
    expect(t).toBe("answer from gemini-3.6-flash");
    expect(state.asked).toEqual(["gemini-3.8-flash", "gemini-3.6-flash"]);
  });

  it("keeps going down the list, and says busy only when every model is busy", async () => {
    for (const m of geminiModels("fast")) state.busy.add(m);
    await expect(aiText({ quality: "fast", system: "s", parts: [{ text: "hi" }] })).rejects.toThrow(/busy/i);
    expect(state.asked.length).toBe(geminiModels("fast").length);
  });

  it("a wrong key is not retried on other models", async () => {
    state.refuse.add("gemini-3.5-flash-lite");
    await expect(aiText({ quality: "fast", system: "s", parts: [{ text: "hi" }] })).rejects.toThrow(/not set up/i);
    expect(state.asked).toEqual(["gemini-3.5-flash-lite"]);
  });
});
