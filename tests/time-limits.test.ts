import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { getLimits, getTimeLimitItems, hoursLabel, runTimeLimitReminders, RULES } from "@/lib/time-limits";
import { saveTimeLimits } from "@/app/(app)/settings/time-limits/actions";

beforeEach(() => logout());

const H = 3600000;
const company = () => db.company.findFirstOrThrow();

async function makeInvoice(number: string, issuedAt: Date) {
  const c = await company();
  const client = await db.client.findFirstOrThrow({ where: { companyId: c.id } });
  return db.invoice.create({ data: { companyId: c.id, number, clientId: client.id, issueDate: issuedAt, status: "SENT", total: 11800, paid: 0 } });
}
const find = async (companyId: string, invId: string, now: Date) => (await getTimeLimitItems(companyId, now)).find((i) => i.ruleKey === "invoice_followup" && i.id === invId);
const notes = (dedupe: string) => db.notification.findMany({ where: { dedupeKey: dedupe } });

afterAll(async () => {
  await db.notification.deleteMany({ where: { dedupeKey: { startsWith: "tat:invoice_followup:" } } });
  await db.invoice.deleteMany({ where: { number: { startsWith: "TL-" } } });
  const c = await company();
  await db.companySettings.update({ where: { companyId: c.id }, data: { tatConfig: Prisma.DbNull } });
});

describe("time limit rules", () => {
  it("has the SOP defaults and a sensible label for each", async () => {
    const c = await company();
    const l = await getLimits(c.id);
    expect(l.invoice_followup).toBe(72); // first follow-up within 3 days
    expect(l.po_release).toBe(24); // PO the same day / next day
    expect(l.snag_closure).toBe(168); // snags closed within 7 days
    expect(Object.keys(l).sort()).toEqual(RULES.map((r) => r.key).sort());
    expect(hoursLabel(24)).toBe("24 hours");
    expect(hoursLabel(1)).toBe("1 hour");
    expect(hoursLabel(72)).toBe("3 days");
  });

  it("flags an invoice as due-soon at 75% of the limit and overdue past it, but not before", async () => {
    const c = await company();
    const issued = new Date("2026-01-10T10:00:00Z");
    const inv = await makeInvoice("TL-1", issued);
    expect(await find(c.id, inv.id, new Date(issued.getTime() + 40 * H))).toBeUndefined(); // 40h of 72h – fine
    expect((await find(c.id, inv.id, new Date(issued.getTime() + 60 * H)))?.state).toBe("due_soon"); // 60h ≥ 54h
    const late = await find(c.id, inv.id, new Date(issued.getTime() + 80 * H));
    expect(late?.state).toBe("overdue");
    expect(Math.round(late!.overdueHours)).toBe(8);
  });

  it("does not list invoices that are fully paid", async () => {
    const c = await company();
    const issued = new Date("2026-01-10T10:00:00Z");
    const inv = await makeInvoice("TL-2", issued);
    await db.invoice.update({ where: { id: inv.id }, data: { paid: 11800, status: "PAID" } });
    expect(await find(c.id, inv.id, new Date(issued.getTime() + 500 * H))).toBeUndefined();
  });

  it("company settings change the limit", async () => {
    const c = await company();
    const issued = new Date("2026-01-10T10:00:00Z");
    const inv = await makeInvoice("TL-3", issued);
    const now = new Date(issued.getTime() + 30 * H);
    expect(await find(c.id, inv.id, now)).toBeUndefined();
    await db.companySettings.update({ where: { companyId: c.id }, data: { tatConfig: { invoice_followup: 24 } } });
    expect((await find(c.id, inv.id, now))?.state).toBe("overdue"); // 30h > 24h
    await db.companySettings.update({ where: { companyId: c.id }, data: { tatConfig: { invoice_followup: "nonsense" } } });
    expect((await getLimits(c.id)).invoice_followup).toBe(72); // bad values fall back to the SOP default
    await db.companySettings.update({ where: { companyId: c.id }, data: { tatConfig: Prisma.DbNull } });
  });
});

describe("escalation: owner → manager → directors, once each", () => {
  it("tells Accounts first, Management after half a limit, the owner after a full limit – and never twice", async () => {
    const c = await company();
    const issued = new Date("2026-02-01T10:00:00Z");
    const inv = await makeInvoice("TL-4", issued);
    const key = (n: number) => `tat:invoice_followup:${inv.id}:L${n}`;
    const accounts = await db.user.findFirstOrThrow({ where: { email: "accounts@dsc.demo" } });
    const owner = await db.user.findFirstOrThrow({ where: { email: "owner@dsc.demo" } });
    const at = (h: number) => new Date(issued.getTime() + h * H);

    await runTimeLimitReminders(c.id, at(50)); // not late yet
    expect((await notes(key(1))).length).toBe(0);

    await runTimeLimitReminders(c.id, at(73)); // 1h late → owner role only
    expect((await notes(key(1))).some((n) => n.userId === accounts.id)).toBe(true);
    expect((await notes(key(2))).length).toBe(0);

    await runTimeLimitReminders(c.id, at(72 + 40)); // 40h late ≥ max(12, 36) → manager level
    await runTimeLimitReminders(c.id, at(72 + 41)); // repeat run changes nothing
    const l1 = await notes(key(1));
    expect(l1.filter((n) => n.userId === accounts.id)).toHaveLength(1);
    expect((await notes(key(2))).length).toBeGreaterThan(0);
    expect((await notes(key(3))).length).toBe(0);

    await runTimeLimitReminders(c.id, at(72 + 80)); // 80h late ≥ max(48, 72) → directors
    expect((await notes(key(3))).some((n) => n.userId === owner.id)).toBe(true);
    const n3 = await notes(key(3));
    expect(n3[0].type).toBe("TIME_LIMIT");
    expect(n3[0].link).toBe(`/finance/invoices/${inv.id}`);
  });
});

describe("changing time limits", () => {
  const form = (over: Record<string, string> = {}) => {
    const f = fd({ reportMorningDue: "10:00", reportMorningDueOutstation: "09:30", reportEveningDue: "19:00", ...over });
    return f;
  };

  it("is owner/admin only", async () => {
    await loginAs("pm@dsc.demo");
    expect((await saveTimeLimits(form())).ok).toBe(false);
    await loginAs("accounts@dsc.demo");
    expect((await saveTimeLimits(form())).ok).toBe(false);
  });

  it("saves limits and report times, and rejects bad input", async () => {
    await loginAs("owner@dsc.demo");
    expect((await saveTimeLimits(form({ rule_invoice_followup: "0" }))).ok).toBe(false);
    expect((await saveTimeLimits(form({ rule_invoice_followup: "abc" }))).ok).toBe(false);
    expect((await saveTimeLimits(form({ reportMorningDue: "25:99" }))).ok).toBe(false);
    expect((await saveTimeLimits(form({ rule_invoice_followup: "48", reportMorningDue: "8:45", reportEveningDue: "18:30" }))).ok).toBe(true);
    const c = await company();
    const s = await db.companySettings.findUniqueOrThrow({ where: { companyId: c.id } });
    expect(s.reportMorningDue).toBe("08:45");
    expect(s.reportEveningDue).toBe("18:30");
    expect((await getLimits(c.id)).invoice_followup).toBe(48);
    expect((await getLimits(c.id)).po_release).toBe(24); // left blank → SOP default
    // restore
    expect((await saveTimeLimits(form())).ok).toBe(true);
    await db.companySettings.update({ where: { companyId: c.id }, data: { tatConfig: Prisma.DbNull } });
  });
});
