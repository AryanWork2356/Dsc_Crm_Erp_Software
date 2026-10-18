import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { projectMetrics, scoreProject, workingDays, type Metrics, type ReviewInput } from "@/lib/scorecard";
import { saveProjectReview } from "@/app/(app)/scorecards/actions";
import { GET as evaluationPdf } from "@/app/(app)/scorecards/[projectId]/pdf/route";

beforeEach(() => logout());

const perfect: Metrics = {
  plannedEnd: new Date("2026-03-30"), endRef: new Date("2026-03-28"), onTime: true, delayDays: 0,
  reportDays: 20, reportsExpected: 40, reportsSent: 40, reportsOnTime: 40, posWithDate: 5, posLate: 0, budgetVariancePct: -3, closurePct: 1, uncertifiedBills: 0,
};
const goodReview: ReviewInput = { clientRating: 5, delayReason: null, delayInControl: null, reworkRequired: false, snagClosedOnTime: true, labourDiscipline: true, wastageControlled: true, safetyFollowed: true, remarks: null };

describe("scorecard maths", () => {
  it("a flawless project scores 100 and is Excellent", () => {
    const s = scoreProject(perfect, goodReview);
    expect(s.total).toBe(100);
    expect(s.label).toBe("Excellent");
    expect(s.provisional).toBe(false);
    expect(s.parts.reduce((a, p) => a + p.max, 0)).toBe(100);
  });

  it("lateness costs points – unless it was outside the team's control", () => {
    const late = { ...perfect, onTime: false, delayDays: 15 };
    expect(scoreProject(late, { ...goodReview!, delayInControl: true }).parts.find((p) => p.key === "time")!.points).toBe(12.5);
    expect(scoreProject(late, { ...goodReview!, delayInControl: false }).parts.find((p) => p.key === "time")!.points).toBe(25);
    expect(scoreProject({ ...perfect, onTime: false, delayDays: 60 }, goodReview).parts.find((p) => p.key === "time")!.points).toBe(0);
  });

  it("missing reports, late deliveries, overspend, rework and a poor client rating all show up", () => {
    const bad: Metrics = { ...perfect, reportsSent: 20, reportsOnTime: 10, posLate: 5, budgetVariancePct: 15, closurePct: 0.4 };
    const s = scoreProject(bad, { ...goodReview!, reworkRequired: true, snagClosedOnTime: false, clientRating: 2, safetyFollowed: false, wastageControlled: false });
    const pts = (k: string) => s.parts.find((p) => p.key === k)!.points;
    expect(pts("reports")).toBeCloseTo(15 * (0.7 * 0.5 + 0.3 * 0.5), 1);
    expect(pts("quality")).toBe(0);
    expect(pts("material")).toBe(0);
    expect(pts("cost")).toBe(0);
    expect(pts("client")).toBe(4);
    expect(pts("docs")).toBe(4);
    expect(pts("safety")).toBe(2);
    expect(s.label).toBe("Needs improvement");
  });

  it("with no review the card is provisional and unknowns are neutral", () => {
    const s = scoreProject({ ...perfect, closurePct: null, budgetVariancePct: null }, null);
    expect(s.provisional).toBe(true);
    expect(s.parts.find((p) => p.key === "quality")!.points).toBe(7.5);
    expect(s.parts.find((p) => p.key === "client")!.points).toBe(5);
    expect(s.parts.find((p) => p.key === "cost")!.points).toBe(5);
    expect(s.total).toBeLessThan(100);
  });

  it("counts working days Monday–Saturday", () => {
    expect(workingDays(new Date("2026-03-02T05:00:00Z"), new Date("2026-03-08T05:00:00Z"))).toBe(6); // Mon..Sun
    expect(workingDays(new Date("2026-03-02T05:00:00Z"), new Date("2026-03-02T05:00:00Z"))).toBe(1);
    expect(workingDays(new Date("2026-03-08T05:00:00Z"), new Date("2026-03-08T05:00:00Z"))).toBe(0); // a Sunday
  });
});

describe("recording the evaluation", () => {
  const project = () => db.project.findFirstOrThrow({ where: { code: "PRJ-00001" } });
  const form = (over: Record<string, string> = {}) => fd({ clientRating: "4", delayInControl: "no", delayReason: "Client changed the design", ...over });

  it("measures real facts for a project that has daily reports", async () => {
    const p = await project();
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    for (const [d, onTime] of [["2026-02-02", true], ["2026-02-03", false], ["2026-02-04", true]] as const) {
      await db.dailyReport.create({ data: { companyId: p.companyId, projectId: p.id, reportDate: new Date(d + "T00:00:00.000Z"), kind: "MORNING", submittedById: sup.id, planNext: "x", manpower: 5, onTime } });
    }
    const m = await projectMetrics(p.companyId, p.id);
    expect(m.reportsSent).toBeGreaterThanOrEqual(3);
    expect(m.reportsOnTime).toBeLessThan(m.reportsSent);
    expect(m.reportsExpected).toBeGreaterThanOrEqual(m.reportsSent);
    expect(m.review).toBeNull();
  });

  it("only the project's own manager, or Management, can record it", async () => {
    const p = await project();
    await loginAs("pm2@dsc.demo"); // PM of other projects
    expect((await saveProjectReview(p.id, form())).ok).toBe(false);
    await loginAs("supervisor@dsc.demo");
    expect((await saveProjectReview(p.id, form())).ok).toBe(false);
    await loginAs("sales@dsc.demo");
    expect((await saveProjectReview(p.id, form())).ok).toBe(false);
    await loginAs("pm@dsc.demo");
    expect((await saveProjectReview(p.id, fd({ delayInControl: "no" }))).ok).toBe(false); // rating missing
    expect((await saveProjectReview(p.id, form())).ok).toBe(true);
  });

  it("saves the answers (unticked boxes mean No) and editing updates, not duplicates", async () => {
    const p = await project();
    await loginAs("pm@dsc.demo");
    // a submitted dialog sends "off" for unticked boxes
    expect((await saveProjectReview(p.id, form({ reworkRequired: "off", snagClosedOnTime: "on", labourDiscipline: "on", wastageControlled: "off", safetyFollowed: "on" }))).ok).toBe(true);
    const r = await db.projectReview.findUniqueOrThrow({ where: { projectId: p.id } });
    expect(r).toMatchObject({ clientRating: 4, reworkRequired: false, snagClosedOnTime: true, wastageControlled: false, safetyFollowed: true, delayInControl: false, delayReason: "Client changed the design" });
    await loginAs("director@dsc.demo");
    expect((await saveProjectReview(p.id, form({ clientRating: "2", reworkRequired: "on" }))).ok).toBe(true);
    expect(await db.projectReview.count({ where: { projectId: p.id } })).toBe(1);
    const again = await db.projectReview.findUniqueOrThrow({ where: { projectId: p.id } });
    expect(again.clientRating).toBe(2);
    expect(again.reworkRequired).toBe(true);
    const m = await projectMetrics(p.companyId, p.id);
    expect(scoreProject(m, m.review).provisional).toBe(false);
  });

  it("the evaluation form PDF opens for people who can see scorecards", async () => {
    const p = await project();
    const call = () => evaluationPdf(new NextRequest("http://localhost/x"), { params: Promise.resolve({ projectId: p.id }) });
    await loginAs("owner@dsc.demo");
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(1500);
    await loginAs("sales@dsc.demo");
    expect((await call()).status).toBe(403);
    logout();
    expect((await call()).status).toBe(403);
  });
});
