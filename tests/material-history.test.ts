import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs, logout, fd } from "./setup";
import { createPurchaseRequest } from "@/app/(app)/procurement/actions";
import { requestLines, projectHistory } from "@/lib/material-history";
import { canOpenDocument } from "@/lib/doc-access";
import { projectOptions } from "@/lib/lookups";
import { projectScope } from "@/lib/scope";
import { featureOff } from "@/lib/features";
import { GET as requestPdf } from "@/app/(app)/procurement/requests/[id]/pdf/route";
import { GET as historyPdf } from "@/app/(app)/procurement/requests/project-pdf/route";

beforeEach(() => logout());
const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`;
// a tiny WebM header: enough for the upload check to see an audio file
const voice = () => new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01])], "voice.webm", { type: "audio/webm" });

async function siteProject() {
  const company = await db.company.findFirstOrThrow();
  const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
  const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
  return db.project.create({ data: { companyId: company.id, code: `PRJ-MH${tag()}`, name: "History test", clientId: client.id, status: "EXECUTION", startDate: new Date(), supervisorId: sup.id } });
}

describe("purchase requests: typed material, voice note, and what is still to be sent", () => {
  it("a coordinator types any material and unit, adds a voice note; only people on the project can play it", async () => {
    const p = await siteProject();
    await loginAs("supervisor@dsc.demo");
    const form = fd({ projectId: p.id, requiredDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), items: JSON.stringify([{ description: "Hettich soft-close hinge (typed)", unit: "pair", quantity: 40 }, { description: "18mm BWP plywood", unit: "sheet", quantity: 10 }]) });
    form.append("voice", voice());
    form.append("voice", voice()); // more than one voice note
    const r = await createPurchaseRequest(form);
    expect(r.ok).toBe(true);
    const id = (r as { data: { id: string } }).data.id;
    const items = await db.purchaseRequestItem.findMany({ where: { requestId: id } });
    expect(items.map((i) => i.unit).sort()).toEqual(["pair", "sheet"]);
    expect(await db.document.count({ where: { entityType: "PURCHASE_REQUEST", entityId: id } })).toBe(2);
    const note = await db.document.findFirstOrThrow({ where: { entityType: "PURCHASE_REQUEST", entityId: id } });
    expect(note.mimeType).toMatch(/^audio\//);
    expect(await canOpenDocument((await getCtx())!, note)).toBe(true);
    await loginAs("procurement@dsc.demo");
    expect(await canOpenDocument((await getCtx())!, note)).toBe(true);
    await loginAs("engineer@dsc.demo"); // not on this project
    expect(await canOpenDocument((await getCtx())!, note)).toBe(false);
  });

  it("requested, ordered, received and pending to send, per request and per project; PDFs for the right people", async () => {
    const p = await siteProject();
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    const vendor = await db.vendor.create({ data: { companyId: p.companyId, code: `V-MH${tag()}`, name: `MH Ply ${tag()}` } });
    const pr = await db.purchaseRequest.create({ data: { companyId: p.companyId, number: `PR-MH${tag()}`, projectId: p.id, requestedById: sup.id, status: "ORDERED", items: { create: [{ description: "18mm Plywood", unit: "sheet", quantity: 10 }, { description: "Fevicol 5kg", unit: "nos", quantity: 4 }] } } });
    await db.purchaseOrder.create({ data: { companyId: p.companyId, number: `PO-MH${tag()}`, vendorId: vendor.id, projectId: p.id, requestId: pr.id, status: "SENT_TO_VENDOR", total: 7080, items: { create: [{ description: "18mm plywood", unit: "Sheet", quantity: 6, receivedQty: 2, rate: 1000, amount: 6000 }] } } });
    await db.purchaseOrder.create({ data: { companyId: p.companyId, number: `PO-MX${tag()}`, vendorId: vendor.id, projectId: p.id, requestId: pr.id, status: "DRAFT", items: { create: [{ description: "Fevicol 5kg", unit: "nos", quantity: 4, rate: 900, amount: 3600 }] } } }); // a draft is not ordered yet

    const lines = await requestLines(pr.id);
    expect(lines.find((l) => l.description === "18mm Plywood")).toMatchObject({ requested: 10, ordered: 6, received: 2, pending: 4 });
    expect(lines.find((l) => l.description === "Fevicol 5kg")).toMatchObject({ requested: 4, ordered: 0, pending: 4 });

    const h = await projectHistory(p.companyId, p.id);
    expect(h.materials.find((m) => m.description === "18mm Plywood")).toMatchObject({ requested: 10, ordered: 6, received: 2, pending: 4, value: 6000 });
    expect(h.money.ordered).toBe(7080);

    await loginAs("supervisor@dsc.demo");
    const own = await requestPdf(new Request("http://x") as never, { params: Promise.resolve({ id: pr.id }) });
    expect(own.status).toBe(200);
    expect(own.headers.get("Content-Type")).toBe("application/pdf");
    const hist = (role: string) => historyPdf(Object.assign(new Request(`http://x/procurement/requests/project-pdf?project=${p.id}`), { nextUrl: new URL(`http://x/procurement/requests/project-pdf?project=${p.id}`) }) as never).then((r) => (void role, r.status));
    expect(await hist("coordinator")).toBe(403); // the full history with money is for the office
    await loginAs("engineer@dsc.demo");
    expect((await requestPdf(new Request("http://x") as never, { params: Promise.resolve({ id: pr.id }) })).status).toBe(403);
    await loginAs("director@dsc.demo");
    expect(await hist("director")).toBe(200);
  });
});

describe("a coordinator sees only their own projects", () => {
  it("project pick-lists (filters) list only the projects they are on", async () => {
    const mine = await siteProject();
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const other = await db.project.create({ data: { companyId: company.id, code: `PRJ-OT${tag()}`, name: "Someone else's site", clientId: client.id, status: "EXECUTION" } });
    await loginAs("supervisor@dsc.demo");
    const c = (await getCtx())!;
    const opts = (await projectOptions(c.companyId, projectScope(c))).map((o) => o.value);
    expect(opts).toContain(mine.id);
    expect(opts).not.toContain(other.id);
  });
});

describe("Site Material section is switched off", () => {
  it("receipts, issues & returns, waste and transfers are gone from the menus", () => {
    for (const h of ["/inventory/receipts", "/inventory/issues", "/inventory/waste", "/transfers"]) expect(featureOff(h)).toBe(true);
    expect(featureOff("/procurement/requests")).toBe(false);
  });
});
