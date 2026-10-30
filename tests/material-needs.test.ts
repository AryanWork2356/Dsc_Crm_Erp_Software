import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { allocateNeeds, problemOf, needBoard, syncMaterialNeeds } from "@/lib/material-needs";
import { reportDay } from "@/lib/site-reports";
import { projectSchedule } from "@/lib/project-schedule";
import { createMaterialNeed, deleteMaterialNeed, updateMaterialNeed } from "@/app/(app)/projects/material-need-actions";

beforeEach(() => logout());
const DAY = 86400000;
const today = reportDay(new Date());
const inDays = (n: number) => new Date(today.getTime() + n * DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("where a material line stands", () => {
  const need = (id: string, qty: number, day: number, description = "18 mm plywood") => ({ id, description, quantity: qty, neededBy: inDays(day) });

  it("serves the earliest need first and never counts the same stock twice", () => {
    const got = allocateNeeds([need("late", 20, 10), need("early", 30, 2)], [
      { description: "18 mm plywood", kind: "arrived", quantity: 30 },
      { description: "18MM PLYWOOD", kind: "open", quantity: 10, eta: inDays(8) },
    ]);
    expect(got.get("early")).toMatchObject({ status: "ARRIVED", arrived: 30 });
    expect(got.get("late")).toMatchObject({ status: "PART_ASKED", ordered: 10, arrived: 0 });
  });

  it("names every stage: not asked, part asked, requested, ordered, part arrived, arrived", () => {
    const s = (supply: Parameters<typeof allocateNeeds>[1]) => allocateNeeds([need("n", 10, 5)], supply).get("n")!.status;
    expect(s([])).toBe("NOT_ASKED");
    expect(s([{ description: "18 mm plywood", kind: "asked", quantity: 4 }])).toBe("PART_ASKED");
    expect(s([{ description: "18 mm plywood", kind: "asked", quantity: 10 }])).toBe("REQUESTED");
    expect(s([{ description: "18 mm plywood", kind: "open", quantity: 10 }])).toBe("ORDERED");
    expect(s([{ description: "18 mm plywood", kind: "arrived", quantity: 3 }, { description: "18 mm plywood", kind: "open", quantity: 7 }])).toBe("PART_ARRIVED");
    expect(s([{ description: "18 mm plywood", kind: "arrived", quantity: 12 }])).toBe("ARRIVED");
    expect(s([{ description: "Gypsum board", kind: "arrived", quantity: 12 }])).toBe("NOT_ASKED"); // a different material does not count
  });

  it("warns at the right time, and stays quiet when things are on track", () => {
    expect(problemOf("NOT_ASKED", inDays(10), null, today, 7)).toBeNull(); // too early to nag
    expect(problemOf("NOT_ASKED", inDays(7), null, today, 7)).toMatchObject({ kind: "NOT_ASKED", severity: "MEDIUM" });
    expect(problemOf("NOT_ASKED", inDays(1), null, today, 7)).toMatchObject({ kind: "NOT_ASKED", severity: "HIGH" });
    expect(problemOf("REQUESTED", inDays(5), null, today, 7)).toBeNull();
    expect(problemOf("REQUESTED", inDays(2), null, today, 7)).toMatchObject({ kind: "NOT_ORDERED" });
    expect(problemOf("ORDERED", inDays(5), inDays(3), today, 7)).toBeNull();
    expect(problemOf("ORDERED", inDays(5), inDays(8), today, 7)).toMatchObject({ kind: "TOO_LATE" });
    expect(problemOf("ORDERED", inDays(1), null, today, 7)).toMatchObject({ kind: "NOT_ARRIVED", severity: "HIGH" });
    expect(problemOf("PART_ARRIVED", inDays(-2), null, today, 7)).toMatchObject({ kind: "LATE", severity: "HIGH" });
    expect(problemOf("ARRIVED", inDays(-2), null, today, 7)).toBeNull();
  });
});

async function newProject() {
  const company = await db.company.findFirstOrThrow();
  const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
  const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
  return db.project.create({ data: { companyId: company.id, code: `PRJ-MN${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`, name: "Materials test", clientId: client.id, status: "EXECUTION", startDate: today, projectManagerId: pm.id } });
}

describe("the materials list of a project", () => {
  it("is kept by people who plan or buy, on projects they can open, and not by the store", async () => {
    const p = await newProject();
    await loginAs("store@dsc.demo");
    expect((await createMaterialNeed(p.id, fd({ description: "Tile adhesive", quantity: "10", unit: "bags", neededBy: iso(inDays(5)) }))).ok).toBe(false);
    await loginAs("supervisor@dsc.demo"); // may plan, but is not on this project
    expect((await createMaterialNeed(p.id, fd({ description: "Tile adhesive", quantity: "10", unit: "bags", neededBy: iso(inDays(5)) }))).ok).toBe(false);
    await loginAs("pm@dsc.demo");
    expect((await createMaterialNeed(p.id, fd({ description: "Tile adhesive", quantity: "0", neededBy: iso(inDays(5)) }))).ok).toBe(false);
    expect((await createMaterialNeed(p.id, fd({ description: "Tile adhesive", quantity: "10", unit: "bags", neededBy: iso(inDays(5)) }))).ok).toBe(true);
    await loginAs("procurement@dsc.demo");
    const n = await db.materialNeed.findFirstOrThrow({ where: { projectId: p.id } });
    expect((await updateMaterialNeed(n.id, fd({ description: "Tile adhesive", quantity: "12", unit: "bags", neededBy: iso(inDays(6)) }))).ok).toBe(true);
    expect(Number((await db.materialNeed.findUniqueOrThrow({ where: { id: n.id } })).quantity)).toBe(12);
  });

  it("warns Procurement once when nobody has asked for it, stops when it is requested, and closes when the line goes", async () => {
    const p = await newProject();
    const company = await db.company.findFirstOrThrow();
    await loginAs("pm@dsc.demo");
    await createMaterialNeed(p.id, fd({ description: "Gypsum board 12.5 mm", quantity: "60", unit: "sheets", neededBy: iso(inDays(5)) }));
    await createMaterialNeed(p.id, fd({ description: "Emulsion paint", quantity: "80", unit: "litres", neededBy: iso(inDays(40)) }));
    const [gypsum, paint] = await db.materialNeed.findMany({ where: { projectId: p.id }, orderBy: { neededBy: "asc" } });

    let board = await needBoard(company.id, [p.id]);
    expect(board.find((r) => r.id === gypsum.id)).toMatchObject({ status: "NOT_ASKED", problem: { kind: "NOT_ASKED" } });
    expect(board.find((r) => r.id === paint.id)!.problem).toBeNull(); // 40 days away: no nagging yet

    await syncMaterialNeeds(company.id);
    await syncMaterialNeeds(company.id); // repeating is safe
    const open = await db.actionItem.findMany({ where: { sourceType: "MaterialNeed", sourceId: gypsum.id, status: { in: ["OPEN", "IN_PROGRESS"] } } });
    expect(open).toHaveLength(1);
    const procurement = await db.user.findFirstOrThrow({ where: { companyId: company.id, role: "PROCUREMENT", isActive: true, deletedAt: null }, orderBy: { createdAt: "asc" } });
    expect(open[0].ownerId).toBe(procurement.id);
    expect(await db.actionItem.count({ where: { sourceType: "MaterialNeed", sourceId: paint.id } })).toBe(0);

    // someone asks for all of it: requested, and 5 days away is still in time to order
    const req = await db.purchaseRequest.create({ data: { companyId: company.id, number: `PR-MN${Date.now().toString(36)}`, projectId: p.id, requestedById: procurement.id, status: "PENDING_APPROVAL", items: { create: [{ description: "Gypsum board 12.5mm", unit: "sheets", quantity: 60 }] } } });
    board = await needBoard(company.id, [p.id]);
    expect(board.find((r) => r.id === gypsum.id)).toMatchObject({ status: "REQUESTED", asked: 60 });
    await syncMaterialNeeds(company.id);
    expect(await db.actionItem.count({ where: { sourceType: "MaterialNeed", sourceId: gypsum.id, status: { in: ["OPEN", "IN_PROGRESS"] } } })).toBe(0);

    // a request that is rejected no longer counts
    await db.purchaseRequest.update({ where: { id: req.id }, data: { status: "REJECTED" } });
    expect((await needBoard(company.id, [p.id])).find((r) => r.id === gypsum.id)!.status).toBe("NOT_ASKED");
    await syncMaterialNeeds(company.id);
    expect(await db.actionItem.count({ where: { sourceType: "MaterialNeed", sourceId: gypsum.id, status: { in: ["OPEN", "IN_PROGRESS"] } } })).toBe(1);

    await loginAs("pm@dsc.demo");
    expect((await deleteMaterialNeed(gypsum.id)).ok).toBe(true);
    expect(await db.actionItem.count({ where: { sourceType: "MaterialNeed", sourceId: gypsum.id, status: { in: ["OPEN", "IN_PROGRESS"] } } })).toBe(0);
  });
});

describe("the day-by-day schedule", () => {
  it("lists the work of every day, the people each trade needs, and no material", async () => {
    const p = await newProject();
    const company = await db.company.findFirstOrThrow();
    await db.projectTask.createMany({ data: [
      { companyId: company.id, projectId: p.id, code: `TSK-A${Date.now()}`, name: "Tiling", startDate: today, dueDate: inDays(2), requiredTrade: "Civil", requiredHeadcount: 4 },
      { companyId: company.id, projectId: p.id, code: `TSK-B${Date.now()}`, name: "Wiring", startDate: inDays(1), dueDate: inDays(1), requiredTrade: "Electrician", requiredHeadcount: 2 },
    ] });
    await db.materialNeed.create({ data: { companyId: company.id, projectId: p.id, description: "Tile adhesive", quantity: 10, neededBy: inDays(1) } });
    const s = await projectSchedule(company.id, p.id);
    expect(s.days).toHaveLength(3);
    expect(s.days[0]).toMatchObject({ dayNo: 1, isToday: true });
    expect(s.days[1].work.map((w) => w.name)).toEqual(["Tiling", "Wiring"]);
    expect(s.days[1].work[0]).toMatchObject({ day: 2, of: 3 });
    expect(s.days[1].people).toEqual([{ trade: "Civil", count: 4 }, { trade: "Electrician", count: 2 }]);
    expect(JSON.stringify(s)).not.toContain("Tile adhesive");
  });
});
