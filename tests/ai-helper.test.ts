import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout } from "./setup";

vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), aiJson: vi.fn(), aiText: vi.fn() }));
import { aiJson, aiText, aiProvider, aiModel } from "@/lib/ai";
import { materialsFromSpeech } from "@/app/(app)/procurement/ai-actions";
import { fixSpelling } from "@/app/(app)/ai-actions";
import { runEveningSummary } from "@/lib/site-summary";
import { ask } from "@/app/(app)/ask/actions";
const aiJsonMock = vi.mocked(aiJson);
const aiTextMock = vi.mocked(aiText);

const KEYS = ["AI_PROVIDER", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"] as const;
beforeEach(() => { logout(); aiJsonMock.mockReset(); aiTextMock.mockReset(); for (const k of KEYS) delete process.env[k]; });
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

describe("spelling fix, evening summary and Ask the app", () => {
  it("the spelling button returns the corrected text and saves nothing", async () => {
    process.env.GEMINI_API_KEY = "g";
    aiTextMock.mockResolvedValue("Tiles have not arrived at the site.");
    await loginAs("supervisor@dsc.demo");
    const r = await fixSpelling("tils not arived at sit");
    expect(r.ok && (r.data as { text: string }).text).toBe("Tiles have not arrived at the site.");
  });

  it("the evening summary goes to the directors once a day, and not at all when the AI is off", async () => {
    const company = await db.company.findFirstOrThrow();
    expect((await runEveningSummary(company.id)).sent).toBe(false); // AI off
    process.env.GEMINI_API_KEY = "g";
    aiTextMock.mockResolvedValue("12 sites, 10 sent both reports. Work stopped at Frido: no tiles.");
    await db.notification.deleteMany({ where: { companyId: company.id, title: { startsWith: "Today on all sites" } } });
    expect((await runEveningSummary(company.id)).sent).toBe(true);
    expect((await runEveningSummary(company.id)).sent).toBe(false); // not twice
    const sent = await db.notification.findMany({ where: { companyId: company.id, title: { startsWith: "Today on all sites" } }, select: { userId: true, body: true } });
    const roles = await db.user.findMany({ where: { id: { in: sent.map((s) => s.userId) } }, select: { role: true } });
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((u) => ["OWNER", "MANAGEMENT"].includes(u.role))).toBe(true);
    expect(sent[0].body).toContain("Work stopped at Frido");
  });

  it("Ask the app: directors get an answer built from their records; coordinators cannot use it", async () => {
    process.env.GEMINI_API_KEY = "g";
    aiTextMock.mockResolvedValue("Aaj Deshpande site pe 15 log the.");
    await loginAs("director@dsc.demo");
    const r = await ask([{ role: "user", text: "Aaj Deshpande site pe kya hua?" }]);
    expect(r.ok && (r.data as { answer: string }).answer).toContain("15 log");
    const prompt = aiTextMock.mock.calls[0][0];
    expect(prompt.system).toContain("PRJ-00001"); // the company's own records are given
    expect(prompt.system).toContain("DETAIL FOR PRJ-00001"); // the site named in the question gets its detail
    await loginAs("supervisor@dsc.demo");
    expect((await ask([{ role: "user", text: "profit?" }])).ok).toBe(false);
  });
});
