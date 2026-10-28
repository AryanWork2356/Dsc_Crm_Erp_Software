import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import "./setup";
import { DESIGNER_ROLES, PM_ROLES, SITE_ROLES, userOptions } from "@/lib/lookups";
import { projectFields } from "@/app/(app)/projects/project-fields";

let seq = 0;
const tag = () => `${Date.now().toString(36)}${seq++}`;

async function person(name: string, role: "PROJECT_MANAGER" | "SITE_SUPERVISOR" | "SITE_ENGINEER" | "DESIGNER" | "OWNER") {
  const company = await db.company.findFirstOrThrow();
  return db.user.create({ data: { companyId: company.id, email: `pl-${tag()}@dscinterior.com`, name, role, passwordHash: "x" } });
}

describe("people lists on the project form", () => {
  it("the Project manager list has project managers only, and never a test login", async () => {
    const company = await db.company.findFirstOrThrow();
    const pm = await person(`Real PM ${tag()}`, "PROJECT_MANAGER");
    const testPm = await person(`Test login: Project Manager ${tag()}`, "PROJECT_MANAGER");
    const owner = await person(`Some Owner ${tag()}`, "OWNER");
    const ids = (await userOptions(company.id, PM_ROLES)).map((o) => o.value);
    expect(ids).toContain(pm.id);
    expect(ids).not.toContain(testPm.id);
    expect(ids).not.toContain(owner.id);
  });

  it("site supervisors and site engineers share one list; designers have their own", async () => {
    const company = await db.company.findFirstOrThrow();
    const sup = await person(`Sup ${tag()}`, "SITE_SUPERVISOR");
    const eng = await person(`Eng ${tag()}`, "SITE_ENGINEER");
    const des = await person(`Des ${tag()}`, "DESIGNER");
    const site = (await userOptions(company.id, SITE_ROLES)).map((o) => o.value);
    expect(site).toEqual(expect.arrayContaining([sup.id, eng.id]));
    expect(site).not.toContain(des.id);
    const designers = (await userOptions(company.id, DESIGNER_ROLES)).map((o) => o.value);
    expect(designers).toContain(des.id);
    expect(designers).not.toContain(sup.id);
  });

  it("no list of people offers a test login, unless asked to (for showing old names)", async () => {
    const company = await db.company.findFirstOrThrow();
    const t = await person(`Test login: Owner ${tag()}`, "OWNER");
    expect((await userOptions(company.id)).map((o) => o.value)).not.toContain(t.id);
    expect((await userOptions(company.id, undefined, true)).map((o) => o.value)).toContain(t.id);
  });

  it("the form has ONE site supervisor / engineer box, and keeps someone already on the project in view", () => {
    const f = projectFields({ clients: [], pms: [], designers: [], site: [{ value: "u1", label: "Anurag" }], names: new Map([["old", "Old Manager"]]), showMoney: false, project: { projectManagerId: "old", supervisorId: "u1" } });
    const names = f.map((x) => x.name);
    expect(names).toContain("supervisorId");
    expect(names).not.toContain("siteEngineerId");
    expect(f.find((x) => x.name === "supervisorId")?.label).toMatch(/supervisor \/ engineer/);
    const pm = f.find((x) => x.name === "projectManagerId");
    expect(pm?.options?.some((o) => o.value === "old" && /Old Manager/.test(o.label))).toBe(true);
  });
});
