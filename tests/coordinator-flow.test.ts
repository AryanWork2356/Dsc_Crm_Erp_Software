import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { projectScope } from "@/lib/scope";
import { loginAs, logout, fd } from "./setup";

vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), aiText: vi.fn() }));
import { aiText } from "@/lib/ai";
import { submitSiteReport } from "@/app/(app)/site-reports/actions";
import { createPurchaseRequest } from "@/app/(app)/procurement/actions";
import { createRemark, replyRemark } from "@/app/(app)/remarks/actions";
import { runEveningSummary, todayOnSites } from "@/lib/site-summary";

const aiTextMock = vi.mocked(aiText);
const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`;
const jpg = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])], name, { type: "image/jpeg" });

beforeEach(() => { logout(); aiTextMock.mockReset(); process.env.GEMINI_API_KEY = "g"; });
afterEach(() => { delete process.env.GEMINI_API_KEY; });

/** Who can open a coordinator's report: the permission AND the project being visible to them. */
async function canOpenReport(email: string, reportId: string) {
  await loginAs(email);
  const c = (await getCtx())!;
  if (!c.can("site_reports:view")) return false;
  return !!(await db.dailyReport.findFirst({ where: { id: reportId, companyId: c.companyId, project: projectScope(c) }, select: { id: true } }));
}

describe("a coordinator's day reaches the right people", () => {
  it("morning problem → admins and procurement told; directors, owner and admin can open it, the project manager cannot; the evening summary carries it to the directors; a request goes for approval; a remark goes to the admins and back", async () => {
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const [sup, pm, admin, buyer] = await Promise.all(["supervisor@dsc.demo", "pm@dsc.demo", "admin@dsc.demo", "procurement@dsc.demo"].map((e) => db.user.findFirstOrThrow({ where: { email: e } })));
    const code = `PRJ-FL${tag()}`;
    const p = await db.project.create({ data: { companyId: company.id, code, name: "Flow site", clientId: client.id, status: "EXECUTION", startDate: new Date(), supervisorId: sup.id, projectManagerId: pm.id, members: { create: [{ userId: sup.id, roleLabel: "Coordinator" }, { userId: pm.id, roleLabel: "PM" }] } } });

    // 1. the coordinator's morning update, with a stopped site
    await loginAs("supervisor@dsc.demo");
    const m = fd({ projectId: p.id, kind: "MORNING", manpower: 9, planNext: "Tiling in the hall", materialStatus: "WORK_STOPPED", issues: "Tiles not delivered" });
    m.set("selfie", jpg("selfie.jpg")); m.append("photos", jpg("site.jpg"));
    const sent = await submitSiteReport(m);
    expect(sent.ok, sent.ok ? "" : sent.error).toBe(true);
    const report = await db.dailyReport.findFirstOrThrow({ where: { projectId: p.id, kind: "MORNING" } });

    const told = await db.notification.findMany({ where: { title: { contains: code } }, select: { userId: true, title: true } });
    expect(told.some((n) => n.userId === admin.id && /WORK STOPPED/.test(n.title))).toBe(true); // the admins
    expect(told.some((n) => n.userId === buyer.id)).toBe(true); // procurement, for the material

    // 2. who can open it
    for (const who of ["owner@dsc.demo", "director@dsc.demo", "admin@dsc.demo", "supervisor@dsc.demo"]) expect(await canOpenReport(who, report.id), who).toBe(true);
    for (const who of ["pm@dsc.demo", "store@dsc.demo", "procurement@dsc.demo", "designer@dsc.demo"]) expect(await canOpenReport(who, report.id), who).toBe(false);

    // 3. the evening summary for the directors includes this site's problem
    const facts = await todayOnSites(company.id, [p.id]);
    expect(facts).toContain(code);
    expect(facts).toContain("Tiles not delivered");
    await db.notification.deleteMany({ where: { companyId: company.id, title: { startsWith: "Today on all sites" } } });
    aiTextMock.mockResolvedValue(`${code}: work stopped, tiles not delivered.`);
    expect((await runEveningSummary(company.id)).sent).toBe(true);
    const summary = await db.notification.findMany({ where: { title: { startsWith: "Today on all sites" } }, select: { userId: true } });
    const roles = (await db.user.findMany({ where: { id: { in: summary.map((s) => s.userId) } }, select: { role: true } })).map((u) => u.role);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((r) => r === "OWNER" || r === "MANAGEMENT")).toBe(true);

    // 4. a material request goes for approval (or is approved within the sender's authority)
    await loginAs("supervisor@dsc.demo");
    const pr = await createPurchaseRequest(fd({ projectId: p.id, requiredDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10), submitNow: "1", items: JSON.stringify([{ description: "Vitrified tiles 600x600", unit: "sqft", quantity: 400 }]) }));
    expect(pr.ok).toBe(true);
    const prId = (pr as { data: { id: string } }).data.id;
    expect(["PENDING_APPROVAL", "APPROVED"]).toContain((await db.purchaseRequest.findUniqueOrThrow({ where: { id: prId } })).status);
    expect(await db.approval.count({ where: { entityType: "PurchaseRequest", entityId: prId } })).toBe(1);

    // 5. a remark to the admins, and their reply back to the coordinator
    const rm = await createRemark(fd({ projectId: p.id, body: "Tile vendor not answering since 9 am" }));
    expect(rm.ok).toBe(true);
    const rid = (rm as { data: { id: string } }).data.id;
    expect(await db.notification.count({ where: { userId: admin.id, link: `/remarks/${rid}` } })).toBe(1);
    await loginAs("admin@dsc.demo");
    expect((await replyRemark(rid, "Spoke to them, delivery at 2 pm")).ok).toBe(true);
    expect(await db.notification.count({ where: { userId: sup.id, link: `/remarks/${rid}` } })).toBe(1);
  });
});
