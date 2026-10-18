import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { changeProjectStatus } from "@/app/(app)/projects/actions";
import { approveClosure, markClosureItem, reopenClosureItem, saveLessons, startClosure, submitClosureReport } from "@/app/(app)/closure/actions";
import { GET as closureReport } from "@/app/(app)/closure/[projectId]/report/route";
import { CLOSURE_ITEMS, loadClosure } from "@/lib/closure";
import { getTimeLimitItems } from "@/lib/time-limits";

beforeEach(() => logout());

const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], "doc.pdf", { type: "application/pdf" });
let projectId = "";
let companyId = "";

describe("project closure checklist", () => {
  it("starts by itself when the project reaches handover and tells HR", async () => {
    const company = await db.company.findFirstOrThrow();
    companyId = company.id;
    const client = await db.client.findFirstOrThrow({ where: { companyId } });
    const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
    const p = await db.project.create({ data: { companyId, code: "PRJ-CL-1", name: "Closure test project", clientId: client.id, status: "SNAGGING", projectManagerId: pm.id, contractValue: 500000 } });
    projectId = p.id;
    expect(await db.projectClosure.count({ where: { projectId } })).toBe(0);
    await loginAs("pm@dsc.demo");
    expect((await changeProjectStatus(projectId, "HANDOVER")).ok).toBe(true);
    const v = await loadClosure(companyId, projectId);
    expect(v?.total).toBe(15);
    expect(v?.total).toBe(CLOSURE_ITEMS.length);
    const hr = await db.user.findFirstOrThrow({ where: { email: "hr@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: hr.id, title: { contains: "Closure checklist started" } } })).toBeGreaterThan(0);
    // asking again (HR may start checklists; PMs may not) does not duplicate it
    await loginAs("pm@dsc.demo");
    expect((await startClosure(projectId)).ok).toBe(false);
    await loginAs("hr@dsc.demo");
    expect((await startClosure(projectId)).ok).toBe(true);
    expect(await db.projectClosureItem.count({ where: { closure: { projectId } } })).toBe(15);
  });

  it("four items are checked by the system from live records", async () => {
    const v1 = await loadClosure(companyId, projectId);
    const state = (k: string) => v1!.items.find((i) => i.key === k)!;
    expect(state("vendor_bills").effectiveDone).toBe(true); // no bills yet
    expect(state("completion_photos").effectiveDone).toBe(false);
    expect(state("lessons").effectiveDone).toBe(false);

    const vendor = await db.vendor.findFirstOrThrow({});
    const bill = await db.vendorBill.create({ data: { companyId, number: "CL-BILL-1", vendorId: vendor.id, projectId, amount: 1000 } });
    expect((await loadClosure(companyId, projectId))!.items.find((i) => i.key === "vendor_bills")!.effectiveDone).toBe(false); // uncertified bill
    await db.vendorBill.update({ where: { id: bill.id }, data: { certifiedAt: new Date() } });
    expect((await loadClosure(companyId, projectId))!.items.find((i) => i.key === "vendor_bills")!.effectiveDone).toBe(true);

    const exp = await db.expense.create({ data: { companyId, description: "Debris removal", amount: 500, projectId, approved: false } });
    expect((await loadClosure(companyId, projectId))!.items.find((i) => i.key === "expense_closure")!.effectiveDone).toBe(false);
    await db.expense.update({ where: { id: exp.id }, data: { approved: true } });
    expect((await loadClosure(companyId, projectId))!.items.find((i) => i.key === "expense_closure")!.effectiveDone).toBe(true);

    await db.document.create({ data: { companyId, name: "p.jpg", type: "SITE_PHOTO", entityType: "PROJECT", entityId: projectId, storageKey: "x/y.jpg", mimeType: "image/jpeg", size: 10 } });
    expect((await loadClosure(companyId, projectId))!.items.find((i) => i.key === "completion_photos")!.effectiveDone).toBe(true);
  });

  it("documents are required, system items can't be ticked by hand, items can be reopened", async () => {
    await loginAs("hr@dsc.demo");
    const items = (await db.projectClosureItem.findMany({ where: { closure: { projectId } } }));
    const letter = items.find((i) => i.key === "handover_letter")!;
    expect((await markClosureItem(letter.id, fd({}))).ok).toBe(false); // needs the document
    const withDoc = fd({ note: "Signed on 12th" });
    withDoc.append("file", pdf());
    expect((await markClosureItem(letter.id, withDoc)).ok).toBe(true);
    const done = await db.projectClosureItem.findUniqueOrThrow({ where: { id: letter.id } });
    expect(done.done).toBe(true);
    expect(done.docId).toBeTruthy();
    expect((await markClosureItem(items.find((i) => i.key === "vendor_bills")!.id, fd({}))).ok).toBe(false); // automatic
    expect((await reopenClosureItem(letter.id)).ok).toBe(true);
    expect((await db.projectClosureItem.findUniqueOrThrow({ where: { id: letter.id } })).done).toBe(false);
    // the supervisor / PM confirmation items need no document
    const sup = items.find((i) => i.key === "supervisor_cert")!;
    expect((await markClosureItem(sup.id, fd({ note: "Review completed" }))).ok).toBe(true);
  });

  it("the report can only be sent when all 15 are done; directors then close the project", async () => {
    await loginAs("hr@dsc.demo");
    const early = await submitClosureReport(projectId);
    expect(early.ok).toBe(false);
    expect((early as { error: string }).error).toMatch(/not done yet/);

    // finish every manual item (+ the Project Director's lessons)
    const manual = await db.projectClosureItem.findMany({ where: { closure: { projectId }, auto: false, done: false } });
    for (const i of manual) {
      const f = fd({});
      if (i.docRequired) f.append("file", pdf());
      expect((await markClosureItem(i.id, f)).ok).toBe(true);
    }
    expect((await saveLessons(projectId, fd({ lessons: "Order tiles earlier." }))).ok).toBe(false); // HR cannot write lessons
    await loginAs("director@dsc.demo");
    expect((await saveLessons(projectId, fd({ lessons: "x" }))).ok).toBe(false); // too short
    expect((await saveLessons(projectId, fd({ lessons: "Order tiles earlier; keep the client's approvals in writing." }))).ok).toBe(true);

    await loginAs("hr@dsc.demo");
    expect((await approveClosure(projectId)).ok).toBe(false); // HR cannot close
    expect((await submitClosureReport(projectId)).ok).toBe(true);
    expect((await submitClosureReport(projectId)).ok).toBe(false); // already submitted
    expect((await db.projectClosure.findUniqueOrThrow({ where: { projectId } })).status).toBe("SUBMITTED");
    const owner = await db.user.findFirstOrThrow({ where: { email: "owner@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: owner.id, title: { contains: "Closure report ready" } } })).toBeGreaterThan(0);

    await loginAs("director@dsc.demo");
    expect((await approveClosure(projectId)).ok).toBe(true);
    expect((await db.projectClosure.findUniqueOrThrow({ where: { projectId } })).status).toBe("CLOSED");
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe("COMPLETED");
    expect((await markClosureItem(manual[0].id, fd({}))).ok).toBe(false); // closed – nothing more to change
  });

  it("the closure report PDF is for people who can see costs, scoped to their projects", async () => {
    const call = async () => closureReport(new NextRequest("http://localhost/x"), { params: Promise.resolve({ projectId }) });
    await loginAs("owner@dsc.demo");
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(1500);
    await loginAs("hr@dsc.demo"); // no cost access
    expect((await call()).status).toBe(403);
    await loginAs("sales@dsc.demo");
    expect((await call()).status).toBe(403);
    logout();
    expect((await call()).status).toBe(403);
  });

  it("an unfinished checklist is escalated after 15 days", async () => {
    const client = await db.client.findFirstOrThrow({ where: { companyId } });
    const p = await db.project.create({ data: { companyId, code: "PRJ-CL-2", name: "Slow closure", clientId: client.id, status: "HANDOVER" } });
    await db.$transaction(async (tx) => {
      const { ensureClosure } = await import("@/lib/closure");
      await ensureClosure(tx, companyId, p.id);
    });
    const cl = await db.projectClosure.findUniqueOrThrow({ where: { projectId: p.id } });
    expect((await getTimeLimitItems(companyId)).some((i) => i.ruleKey === "closure_checklist" && i.id === cl.id)).toBe(false);
    await db.projectClosure.update({ where: { id: cl.id }, data: { startedAt: new Date(Date.now() - 20 * 86400000) } });
    const hit = (await getTimeLimitItems(companyId)).find((i) => i.ruleKey === "closure_checklist" && i.id === cl.id);
    expect(hit?.state).toBe("overdue");
    expect(hit?.ownerRoles).toContain("HR");
  });

  it("sales cannot touch closure; accounts can only look", async () => {
    await loginAs("sales@dsc.demo");
    expect((await startClosure(projectId)).ok).toBe(false);
    await loginAs("accounts@dsc.demo");
    const item = await db.projectClosureItem.findFirstOrThrow({ where: { closure: { projectId } } });
    expect((await markClosureItem(item.id, fd({}))).ok).toBe(false);
  });
});
