import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout } from "./setup";

vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), aiJson: vi.fn() }));
import { aiJson, aiProvider, aiModel } from "@/lib/ai";
import { materialsFromSpeech } from "@/app/(app)/procurement/ai-actions";
const aiJsonMock = vi.mocked(aiJson);

const KEYS = ["AI_PROVIDER", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"] as const;
beforeEach(() => { logout(); aiJsonMock.mockReset(); for (const k of KEYS) delete process.env[k]; });
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

describe("one switch for the AI provider", () => {
  it("is off with no key, uses whichever key is set, and AI_PROVIDER picks when both are", () => {
    expect(aiProvider()).toBeNull();
    process.env.GEMINI_API_KEY = "g";
    expect(aiProvider()).toBe("gemini");
    expect(aiModel("careful")).toMatch(/^gemini-/);
    process.env.ANTHROPIC_API_KEY = "c";
    expect(aiProvider()).toBe("gemini");
    process.env.AI_PROVIDER = "claude";
    expect(aiProvider()).toBe("claude");
    expect(aiModel("careful")).toMatch(/^claude-/);
    delete process.env.ANTHROPIC_API_KEY;
    expect(aiProvider()).toBe("gemini"); // asked for Claude but it has no key: use what works
  });
});

describe("say the material request", () => {
  it("turns what was said into checked rows: catalogue names matched, bad lines dropped, past dates ignored", async () => {
    process.env.GEMINI_API_KEY = "g";
    const company = await db.company.findFirstOrThrow();
    const name = `Plywood 18mm BWP ${Date.now().toString(36)}`;
    const mat = await db.material.create({ data: { companyId: company.id, sku: `M-AI${Date.now().toString(36)}`, name, unit: "sheet" } });
    aiJsonMock.mockResolvedValue({
      items: [
        { description: "18mm plywood", quantity: 20, unit: "nos", catalogName: name.toUpperCase() },
        { description: "Fevicol 5kg", quantity: 5, unit: "dabba", catalogName: null },
        { description: "Nothing", quantity: 0, unit: "nos", catalogName: null },
      ],
      neededBy: "2001-01-01",
      reason: "Kitchen shutters",
      unclear: null,
    });
    await loginAs("supervisor@dsc.demo");
    const r = await materialsFromSpeech("kal ke liye 20 sheet plywood aur 5 dabba fevicol");
    expect(r.ok).toBe(true);
    const d = (r as { data: { items: { description: string; quantity: number; unit: string; materialId: string | null }[]; neededBy: string | null; reason: string | null } }).data;
    expect(d.items).toHaveLength(2);
    expect(d.items[0]).toMatchObject({ description: name, quantity: 20, unit: "sheet", materialId: mat.id }); // the list's own name and unit
    expect(d.items[1]).toMatchObject({ description: "Fevicol 5kg", quantity: 5, unit: "dabba", materialId: null });
    expect(d.neededBy).toBeNull(); // a date in the past is not taken
    expect(d.reason).toBe("Kitchen shutters");
    const sent = aiJsonMock.mock.calls[0][0];
    expect(JSON.stringify(sent.parts)).toContain(name); // the company's material list is given to the AI
  });

  it("says so plainly when the AI is off, and only people who raise requests may use it", async () => {
    await loginAs("supervisor@dsc.demo");
    const off = await materialsFromSpeech("20 sheet plywood");
    expect(off.ok).toBe(false);
    expect(aiJsonMock).not.toHaveBeenCalled();
    process.env.GEMINI_API_KEY = "g";
    await loginAs("hr@dsc.demo");
    expect((await materialsFromSpeech("20 sheet plywood")).ok).toBe(false);
  });
});
