import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs, logout, fd } from "./setup";
import { canOpenDocument, DOWNLOADS_FOLDER } from "@/lib/doc-access";
import { uploadDocument } from "@/app/(app)/documents/actions";
import { pasteSchedule } from "@/app/(app)/projects/actions";
import { pastedRows } from "@/lib/schedule-import";
import { roleFor, planStaffLogins } from "@/lib/staff-logins";
import { applyStaffLogins, previewStaffLogins } from "@/app/(app)/settings/actions";
import { can, OFFERED_ROLES, ROLE_LABELS } from "@/lib/permissions";
import { GET as boqExcel } from "@/app/(app)/sales/boq/[id]/export/route";
import { reportDay } from "@/lib/site-reports";

beforeEach(() => logout());
const today = reportDay(new Date());
const pdf = (name = "papers.pdf") => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], name, { type: "application/pdf" });

async function siteProject() {
  const company = await db.company.findFirstOrThrow();
  const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
  const [pm, sup] = await Promise.all([db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } }), db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } })]);
  return db.project.create({ data: { companyId: company.id, code: `PRJ-DR${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`, name: "Rules test", clientId: client.id, status: "EXECUTION", startDate: today, projectManagerId: pm.id, supervisorId: sup.id } });
}

describe("DSC roles", () => {
  it("only DSC's roles are offered, with DSC's names; managers and coordinators see no rates, profit or quotations", () => {
    expect(OFFERED_ROLES).toEqual(["SITE_SUPERVISOR", "PROJECT_MANAGER", "DESIGNER", "ADMIN", "MANAGEMENT", "HR", "ACCOUNTS"]);
    expect(ROLE_LABELS.SITE_SUPERVISOR).toBe("Project Coordinator");
    expect(ROLE_LABELS.MANAGEMENT).toBe("Director");
    for (const r of ["PROJECT_MANAGER", "SITE_SUPERVISOR"] as const) {
      expect(can(r, "margins:view")).toBe(false);
      expect(can(r, "quotations:view")).toBe(false);
      expect(can(r, "boq:view")).toBe(true); // the BOQ, without rates
      expect(can(r, "tasks:create")).toBe(false); // the schedule: view, not upload
      expect(can(r, "tasks:edit")).toBe(true); // but they update the work
    }
    expect(can("MANAGEMENT", "tasks:create")).toBe(true);
    expect(can("MANAGEMENT", "margins:view")).toBe(true);
  });

  it("staff logins: directors, admins, HR, designer, accounts by name; everyone else Project Coordinator; directors with full access keep it", () => {
    expect(roleFor("Harendra Shukla", "MANAGEMENT")).toBe("MANAGEMENT");
    expect(roleFor("Rupesh Sharma", "OWNER")).toBe("OWNER");
    expect(roleFor("Gopal Sharma", "PROJECT_MANAGER")).toBe("MANAGEMENT");
    expect(roleFor("Shreya Jadhav", "PROJECT_MANAGER")).toBe("ADMIN");
    expect(roleFor("Shravani Bhalerkar", "ACCOUNTS")).toBe("ADMIN");
    expect(roleFor("Sakshi Singh", "HR")).toBe("HR");
    expect(roleFor("Bipin Ghorecha", "PROJECT_MANAGER")).toBe("DESIGNER");
    expect(roleFor("Pradeep Yadav", "PROJECT_MANAGER")).toBe("SITE_SUPERVISOR");
    expect(roleFor("Mohd. Shamshad Alam", "SITE_SUPERVISOR")).toBe("SITE_SUPERVISOR");
    expect(roleFor("Aryan Shetty", "OWNER")).toBe("OWNER");
  });

  it("the staff login plan never touches test logins, and only a director with full access may run it", async () => {
    const company = await db.company.findFirstOrThrow();
    const u = await db.user.create({ data: { companyId: company.id, email: `pradeep.y${Date.now()}@dsc.test`, name: "Pradeep Yadavtest", role: "PROJECT_MANAGER", passwordHash: "x" } });
    const plan = await planStaffLogins(company.id);
    expect(plan.some((r) => r.oldId.endsWith("@dsc.demo"))).toBe(false);
    const mine = plan.find((r) => r.userId === u.id)!;
    expect(mine).toMatchObject({ newRole: "SITE_SUPERVISOR" });
    expect(mine.newId).toMatch(/^pradeep\.y[a-z]*\d*@dscinterior\.com$/);
    await loginAs("admin@dsc.demo");
    expect((await previewStaffLogins()).ok).toBe(false);
    expect((await applyStaffLogins()).ok).toBe(false);
    await loginAs("owner@dsc.demo");
    expect((await previewStaffLogins()).ok).toBe(true);
    await db.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } }); // keep the shared test data as it was
  });
});

describe("project documents: anyone on the project uploads, only directors open them; Downloadables are for the whole team", () => {
  it("works as described", async () => {
    const p = await siteProject();
    await loginAs("supervisor@dsc.demo");
    const up = fd({ entityType: "PROJECT", entityId: p.id }); up.set("file", pdf("client-letter.pdf"));
    expect((await uploadDocument(up)).ok).toBe(true);
    const doc = await db.document.findFirstOrThrow({ where: { entityType: "PROJECT", entityId: p.id, name: "client-letter.pdf" } });
    expect(await canOpenDocument((await getCtx())!, doc)).toBe(false); // not even the person who uploaded it
    const sneak = fd({ entityType: "PROJECT", entityId: p.id, folder: DOWNLOADS_FOLDER }); sneak.set("file", pdf("x.pdf"));
    expect((await uploadDocument(sneak)).ok).toBe(false); // only directors and admins share files with the team

    await loginAs("pm@dsc.demo");
    expect(await canOpenDocument((await getCtx())!, doc)).toBe(false);
    await loginAs("director@dsc.demo");
    expect(await canOpenDocument((await getCtx())!, doc)).toBe(true);
    const share = fd({ entityType: "PROJECT", entityId: p.id, folder: DOWNLOADS_FOLDER, type: "DRAWING" }); share.set("file", pdf("kitchen-drawing.pdf"));
    expect((await uploadDocument(share)).ok).toBe(true);
    const drawing = await db.document.findFirstOrThrow({ where: { entityType: "PROJECT", entityId: p.id, name: "kitchen-drawing.pdf" } });
    await loginAs("supervisor@dsc.demo");
    expect(await canOpenDocument((await getCtx())!, drawing)).toBe(true);
    await loginAs("store@dsc.demo"); // not on the project
    expect(await canOpenDocument((await getCtx())!, drawing)).toBe(false);
  });
});

describe("pasting a schedule from Excel", () => {
  it("reads the copied rows (tabs) with the column names on top, and adds the work", async () => {
    const text = "Sl No\tTask\tTrade\tPeople needed\tStart day\tEnd day\r\n1\tElectrical conduit\tElectrician\t2\t1\t7\r\n\r\n2\tPainting\tPainter\t3\t20\t30\r\n";
    const rows = pastedRows(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Task: "Electrical conduit", "End day": "7" });
    const p = await siteProject();
    await loginAs("supervisor@dsc.demo");
    expect((await pasteSchedule(p.id, fd({ work: text }))).ok).toBe(false); // coordinators do not upload the schedule
    await loginAs("director@dsc.demo");
    const r = await pasteSchedule(p.id, fd({ work: text }));
    expect(r.ok && r.message).toMatch(/2 tasks/);
    const t = await db.projectTask.findFirstOrThrow({ where: { projectId: p.id, name: "Painting" } });
    expect(Math.round((t.dueDate!.getTime() - t.startDate!.getTime()) / 86400000) + 1).toBe(11); // a job that runs 11 days is one row
    expect((await pasteSchedule(p.id, fd({ work: "only one line" }))).ok).toBe(false);
  });
});

describe("the BOQ download", () => {
  it("has rates and amounts for directors, quantities only for managers", async () => {
    const company = await db.company.findFirstOrThrow();
    const b = await db.boq.create({ data: { companyId: company.id, number: `BOQ-DR${Date.now().toString(36)}`, title: "Download test", items: { create: [{ sortOrder: 0, item: "Wardrobe", unit: "sqft", quantity: 10, sellingRate: 1500, total: 15000 }] } } });
    const headersFor = async (email: string) => {
      await loginAs(email);
      const res = await boqExcel(new Request("http://x") as never, { params: Promise.resolve({ id: b.id }) });
      if (res.status !== 200) return res.status;
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as never);
      return (wb.worksheets[0].getRow(3).values as unknown[]).filter(Boolean);
    };
    expect(await headersFor("director@dsc.demo")).toEqual(["Category", "Item", "Specification", "Unit", "Quantity", "Rate", "Amount"]);
    expect(await headersFor("pm@dsc.demo")).toBe(403); // managers view the BOQ on screen, without rates; no export
  });
});
