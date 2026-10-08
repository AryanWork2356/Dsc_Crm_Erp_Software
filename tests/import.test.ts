import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout } from "./setup";
import { importFile } from "@/app/(app)/settings/import/actions";
import { GET as templateRoute } from "@/app/(app)/settings/import/template/route";
import { NextRequest } from "next/server";

beforeEach(() => logout());

const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");
const send = (entity: string, text: string, mode: "check" | "import", name = "data.csv") => {
  const fd = new FormData();
  fd.set("entity", entity);
  fd.set("mode", mode);
  fd.set("file", new File([text], name));
  return importFile(fd);
};

describe("bulk import", () => {
  it("checks first (writes nothing), then imports; re-uploading skips what already exists", async () => {
    await loginAs("admin@dsc.demo");
    const file = csv([["Name", "Company", "Phone", "Email", "GSTIN"], ["Import Client One", "ICO Pvt", "98100 00001", "one@example.com", ""], ["Import Client Two", "", "98100 00002", "", "27AABCI1111A1Z5"]]);
    const before = await db.client.count();
    const chk = await send("clients", file, "check");
    expect(chk.ok && chk.data?.valid).toBe(2);
    expect(await db.client.count()).toBe(before); // check wrote nothing
    const imp = await send("clients", file, "import");
    expect(imp.ok && imp.data?.created).toBe(2);
    expect(await db.client.count()).toBe(before + 2);
    const row = await db.client.findFirstOrThrow({ where: { name: "Import Client One" } });
    expect(row.code).toMatch(/^CL-\d{5}$/);
    const again = await send("clients", file, "import");
    expect(again.ok && again.data?.created).toBe(0);
    expect(again.ok && again.data?.duplicates).toBe(2);
    expect(await db.client.count()).toBe(before + 2);
  });

  it("lists every bad row with its row number and imports nothing when any row is bad", async () => {
    await loginAs("admin@dsc.demo");
    const file = csv([["Name", "Phone", "GSTIN"], ["Good Vendor Row", "98100 11111", ""], ["", "98100 22222", ""], ["Bad Phone", "abc", ""], ["Bad GST", "98100 33333", "123"]]);
    const r = await send("vendors", file, "import");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data!.errors.map((e) => e.row)).toEqual([3, 4, 5]);
      expect(r.data!.created).toBe(0);
    }
    expect(await db.vendor.count({ where: { name: "Good Vendor Row" } })).toBe(0); // all-or-nothing
  });

  it("rejects wrong layout, wrong file type, oversized files and unknown entities", async () => {
    await loginAs("admin@dsc.demo");
    expect((await send("clients", csv([["Company"], ["x"]]), "check")).ok).toBe(false); // no Name column
    expect((await send("clients", "x", "check", "data.txt")).ok).toBe(false);
    expect((await send("clients", csv([["Name"]]), "check")).ok).toBe(false); // header only
    expect((await send("nonsense", csv([["Name"], ["x"]]), "check")).ok).toBe(false);
    const big = csv([["Name"], ...Array.from({ length: 2100 }, (_, i) => [`N${i}`])]);
    expect((await send("clients", big, "check")).ok).toBe(false);
  });

  it("understands quoted commas, mixed-case headers, enums and numbers with commas", async () => {
    await loginAs("admin@dsc.demo");
    const file = csv([["name", "category", "unit", "cost"], ['Teak "Premium" wood, 2 inch', "carpentry", "rft", "1,250"], ["Odd category", "NOT_A_CATEGORY", "nos", "10"]]);
    const chk = await send("materials", file, "check");
    expect(chk.ok && chk.data?.errors.map((e) => e.row)).toEqual([3]);
    const ok = await send("materials", csv([["name", "category", "unit", "cost"], ['Teak "Premium" wood, 2 inch', "carpentry", "rft", "1,250"]]), "import");
    expect(ok.ok && ok.data?.created).toBe(1);
    const m = await db.material.findFirstOrThrow({ where: { name: 'Teak "Premium" wood, 2 inch' } });
    expect(m.category).toBe("CARPENTRY");
    expect(Number(m.purchaseCost)).toBe(1250);
    expect(m.sku).toMatch(/^MAT-\d{5}$/);
  });

  it("workers need a wage matching their pay type; leads are auto-assigned to a salesperson", async () => {
    await loginAs("admin@dsc.demo");
    const bad = await send("workers", csv([["Name", "Trade", "Wage type", "Daily wage"], ["No Wage", "painter", "daily", ""]]), "check");
    expect(bad.ok && bad.data?.errors.length).toBe(1);
    const good = await send("workers", csv([["Name", "Phone", "Trade", "Wage type", "Daily wage", "Joining date"], ["Imported Painter", "98100 44444", "painter", "daily", "850", "31/03/2024"]]), "import");
    expect(good.ok && good.data?.created).toBe(1);
    expect((await db.worker.findFirstOrThrow({ where: { name: "Imported Painter" } })).joiningDate?.toISOString().slice(0, 10)).toBe("2024-03-31");
    const leads = await send("leads", csv([["Name", "Phone", "Segment", "Estimated value"], ["Imported Lead", "98100 55555", "retail", "₹5,00,000"]]), "import");
    expect(leads.ok && leads.data?.created).toBe(1);
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Imported Lead" } });
    expect(lead.segment).toBe("RETAIL");
    expect(Number(lead.estimatedValue)).toBe(500000);
    expect((await db.user.findUniqueOrThrow({ where: { id: lead.assignedToId! } })).role).toBe("SALES");
  });

  it("permissions: each entity needs its own create right; templates are protected", async () => {
    await loginAs("designer@dsc.demo");
    expect((await send("clients", csv([["Name"], ["X"]]), "check")).ok).toBe(false);
    expect((await send("employees", csv([["Name"], ["X"]]), "check")).ok).toBe(false);
    await loginAs("store@dsc.demo");
    expect((await send("materials", csv([["Name"], ["Store imported item"]]), "import")).ok).toBe(true);
    expect((await send("vendors", csv([["Name"], ["X"]]), "check")).ok).toBe(false);
    const t = (e: string) => templateRoute(new NextRequest(`http://localhost/settings/import/template?entity=${e}`));
    expect((await t("materials")).status).toBe(200);
    expect(await (await t("materials")).text()).toContain("Name,SKU,Category");
    expect((await t("vendors")).status).toBe(403);
    logout();
    expect((await t("materials")).status).toBe(403);
  });
});
