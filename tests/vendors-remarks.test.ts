import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createProject, updateProject } from "@/app/(app)/projects/actions";
import { createVendor } from "@/app/(app)/procurement/actions";
import { createRemark, replyRemark, setRemarkResolved } from "@/app/(app)/remarks/actions";
import { vendorTrades } from "@/lib/trades";
import { remarkScope } from "@/lib/remarks";
import { getCtx } from "@/lib/auth";

beforeEach(() => logout());
const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`;

describe("vendors by trade", () => {
  it("a vendor's trades come from tick boxes; older typed trades are still understood", async () => {
    expect(vendorTrades("Carpenter, Electrician")).toEqual(["ELECTRICAL", "CARPENTRY"]);
    expect(vendorTrades("Painting, Fire alarm")).toEqual(["PAINTING", "FIRE_ALARM"]);
    await loginAs("director@dsc.demo");
    const r = await createVendor(fd({ name: `Shubh Painters ${tag()}`, trade_PAINTING: "on", trade_CIVIL: "on" }));
    expect(r.ok).toBe(true);
    const v = await db.vendor.findUniqueOrThrow({ where: { id: (r as { data: { id: string } }).data.id } });
    expect(v.trades).toBe("Painting, Civil");
  });

  it("only directors add projects and choose a vendor per trade; everyone on the project sees them; an admin's edit keeps them", async () => {
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const painter = await db.vendor.create({ data: { companyId: company.id, code: `V-P${tag()}`, name: "Painter Co", trades: "Painting" } });
    const sparky = await db.vendor.create({ data: { companyId: company.id, code: `V-E${tag()}`, name: "Sparky Electricals", trades: "Electrical" } });

    await loginAs("admin@dsc.demo");
    expect((await createProject(fd({ name: "Admin try", clientId: client.id }))).ok).toBe(false); // directors only

    await loginAs("director@dsc.demo");
    const r = await createProject(fd({ name: `Vendor test ${tag()}`, clientId: client.id, vendor_PAINTING: painter.id, vendor_ELECTRICAL: sparky.id, vendor_CIVIL: "" }));
    expect(r.ok).toBe(true);
    const id = (r as { data: { id: string } }).data.id;
    const chosen = await db.projectVendor.findMany({ where: { projectId: id } });
    expect(chosen.map((x) => `${x.trade}:${x.vendorId}`).sort()).toEqual([`ELECTRICAL:${sparky.id}`, `PAINTING:${painter.id}`].sort());

    await loginAs("admin@dsc.demo"); // an admin may edit the project, but the vendors stay as the directors chose
    expect((await updateProject(id, fd({ name: "Vendor test (renamed)", clientId: client.id, vendor_PAINTING: "" }))).ok).toBe(true);
    expect(await db.projectVendor.count({ where: { projectId: id } })).toBe(2);

    await loginAs("director@dsc.demo"); // a director clears one
    expect((await updateProject(id, fd({ name: "Vendor test (renamed)", clientId: client.id, vendor_PAINTING: "", vendor_ELECTRICAL: sparky.id }))).ok).toBe(true);
    expect((await db.projectVendor.findMany({ where: { projectId: id } })).map((x) => x.trade)).toEqual(["ELECTRICAL"]);
  });
});

describe("remarks: the coordinator raises, the admins reply", () => {
  it("works end to end, and other coordinators do not see it", async () => {
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
    const admin = await db.user.findFirstOrThrow({ where: { email: "admin@dsc.demo" } });
    const painter = await db.vendor.create({ data: { companyId: company.id, code: `V-R${tag()}`, name: "Late Painters", trades: "Painting", phone: "9800000000" } });
    const p = await db.project.create({ data: { companyId: company.id, code: `PRJ-RM${tag()}`, name: "Remark site", clientId: client.id, status: "EXECUTION", supervisorId: sup.id, tradeVendors: { create: [{ companyId: company.id, trade: "PAINTING", vendorId: painter.id }] } } });

    await loginAs("supervisor@dsc.demo");
    const r = await createRemark(fd({ projectId: p.id, trade: "PAINTING", body: "Painter not answering since morning" }));
    expect(r.ok).toBe(true);
    const id = (r as { data: { id: string } }).data.id;
    expect((await db.remark.findUniqueOrThrow({ where: { id } })).vendorId).toBe(painter.id); // the project's painter is attached
    expect(await db.notification.count({ where: { userId: admin.id, link: `/remarks/${id}` } })).toBe(1);

    await loginAs("admin@dsc.demo");
    expect((await replyRemark(id, "Spoke to him, coming at 11 am")).ok).toBe(true);
    expect(await db.notification.count({ where: { userId: sup.id, link: `/remarks/${id}` } })).toBe(1);
    expect((await setRemarkResolved(id, true)).ok).toBe(true);
    expect((await db.remark.findUniqueOrThrow({ where: { id } })).status).toBe("RESOLVED");

    await loginAs("engineer@dsc.demo"); // not on that project
    const other = (await getCtx())!;
    expect(await db.remark.count({ where: { id, ...remarkScope(other) } })).toBe(0);
    expect((await replyRemark(id, "hello")).ok).toBe(false);
  });
});
