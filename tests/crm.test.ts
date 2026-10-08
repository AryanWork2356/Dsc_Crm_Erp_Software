import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import {
  createLead, updateLead, changeLeadStage, convertLeadToClient, setFollowUp, addLeadActivity, deleteLead,
  createClient, updateClient, createSiteVisit, completeSiteVisit,
} from "@/app/(app)/crm/actions";

beforeEach(() => logout());

describe("authentication guard", () => {
  it("rejects actions when signed out", async () => {
    const r = await createLead(fd({ name: "X" }));
    expect(r.ok).toBe(false);
  });
});

describe("leads", () => {
  it("validates required fields and phone format", async () => {
    await loginAs("sales@dsc.demo");
    const r = await createLead(fd({ name: "", phone: "abc" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors?.name).toBeTruthy();
      expect(r.fieldErrors?.phone).toBeTruthy();
    }
  });

  it("sales creates a lead owned by themselves with a sequential code, activity and audit entry", async () => {
    const u = await loginAs("sales@dsc.demo");
    const r = await createLead(fd({ name: "Test Lead A", phone: "+91 98000 00001", estimatedValue: 500000, segment: "COMMERCIAL" }));
    expect(r.ok).toBe(true);
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Test Lead A" } });
    expect(lead.assignedToId).toBe(u.id);
    expect(lead.code).toMatch(/^LD-\d{5}$/);
    expect(Number(lead.estimatedValue)).toBe(500000);
    expect(await db.leadActivity.count({ where: { leadId: lead.id } })).toBe(1);
    const log = await db.auditLog.findFirst({ where: { entityId: lead.id, action: "CREATE" } });
    expect(log?.summary).toContain("Test Lead A");
  });

  it("auto-assigns a salesperson when management creates a lead without owner", async () => {
    await loginAs("admin@dsc.demo");
    const r = await createLead(fd({ name: "Test Lead Auto" }));
    expect(r.ok).toBe(true);
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Test Lead Auto" } });
    const owner = await db.user.findUniqueOrThrow({ where: { id: lead.assignedToId! } });
    expect(owner.role).toBe("SALES");
  });

  it("generates unique codes under concurrent creation", async () => {
    await loginAs("admin@dsc.demo");
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => createLead(fd({ name: `Concurrent ${i}` }))));
    expect(results.every((r) => r.ok)).toBe(true);
    const leads = await db.lead.findMany({ where: { name: { startsWith: "Concurrent " } } });
    expect(new Set(leads.map((l) => l.code)).size).toBe(6);
  });

  it("moves through stages, logs history, and requires a reason for Lost", async () => {
    await loginAs("sales@dsc.demo");
    await createLead(fd({ name: "Stage Lead" }));
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Stage Lead" } });

    expect((await changeLeadStage(lead.id, "QUALIFIED")).ok).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("QUALIFIED");

    const noReason = await changeLeadStage(lead.id, "LOST");
    expect(noReason.ok).toBe(false);
    expect((await changeLeadStage(lead.id, "LOST", "Chose competitor")).ok).toBe(true);
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stage).toBe("LOST");
    expect(after.lostReason).toBe("Chose competitor");
    expect(await db.leadActivity.count({ where: { leadId: lead.id, kind: "STAGE_CHANGE" } })).toBe(2);
  });

  it("a call activity moves a NEW lead to CONTACTED", async () => {
    await loginAs("sales@dsc.demo");
    await createLead(fd({ name: "Call Lead" }));
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Call Lead" } });
    await addLeadActivity(lead.id, fd({ kind: "CALL", body: "Spoke to client" }));
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("CONTACTED");
  });

  it("schedules a follow-up", async () => {
    await loginAs("sales@dsc.demo");
    await createLead(fd({ name: "FU Lead" }));
    const lead = await db.lead.findFirstOrThrow({ where: { name: "FU Lead" } });
    const r = await setFollowUp(lead.id, fd({ nextFollowUp: "2030-01-15", note: "Share designs" }));
    expect(r.ok).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).nextFollowUp?.toISOString().slice(0, 10)).toBe("2030-01-15");
  });

  it("sales cannot see or edit another salesperson's lead", async () => {
    await loginAs("sales2@dsc.demo");
    const other = await db.lead.findFirstOrThrow({ where: { assignedToId: (await db.user.findFirstOrThrow({ where: { email: "sales@dsc.demo" } })).id } });
    const r = await updateLead(other.id, fd({ name: "Hacked" }));
    expect(r.ok).toBe(false);
    expect((await db.lead.findUniqueOrThrow({ where: { id: other.id } })).name).not.toBe("Hacked");
  });

  it("lead → client conversion carries data forward and is idempotent", async () => {
    await loginAs("sales@dsc.demo");
    await createLead(fd({ name: "Convert Me", phone: "+91 98000 11111", email: "convert@example.com", location: "Thane", requirement: "Full home" }));
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Convert Me" } });
    const r1 = await convertLeadToClient(lead.id);
    expect(r1.ok).toBe(true);
    const l2 = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { client: true } });
    expect(l2.client?.name).toBe("Convert Me");
    expect(l2.client?.phone).toBe("+91 98000 11111");
    expect(l2.client?.email).toBe("convert@example.com");
    const before = await db.client.count();
    await convertLeadToClient(lead.id);
    expect(await db.client.count()).toBe(before);
  });

  it("only roles with delete permission can delete; sales cannot", async () => {
    await loginAs("sales@dsc.demo");
    await createLead(fd({ name: "Delete Me" }));
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Delete Me" } });
    expect((await deleteLead(lead.id)).ok).toBe(false);
    await loginAs("owner@dsc.demo");
    expect((await deleteLead(lead.id)).ok).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).deletedAt).not.toBeNull();
  });
});

describe("clients", () => {
  it("validates GSTIN and PAN formats", async () => {
    await loginAs("admin@dsc.demo");
    const bad = await createClient(fd({ name: "Bad GST", gstin: "123", pan: "xyz" }));
    expect(bad.ok).toBe(false);
    const good = await createClient(fd({ name: "Good GST Client", gstin: "27AABCD1234E1Z5", pan: "AABCD1234E" }));
    expect(good.ok).toBe(true);
  });

  it("updates a client and records old/new values in the audit log", async () => {
    await loginAs("admin@dsc.demo");
    const c = await db.client.findFirstOrThrow({ where: { name: "Good GST Client" } });
    expect((await updateClient(c.id, fd({ name: "Good GST Client", phone: "+91 98111 22222" }))).ok).toBe(true);
    const log = await db.auditLog.findFirst({ where: { entityId: c.id, action: "UPDATE" } });
    expect(log).toBeTruthy();
  });

  it("designer cannot create clients", async () => {
    await loginAs("designer@dsc.demo");
    expect((await createClient(fd({ name: "Nope" }))).ok).toBe(false);
  });
});

describe("site visits", () => {
  it("scheduling a visit moves the lead to Site Visit Scheduled; completing moves it forward", async () => {
    await loginAs("sales@dsc.demo");
    await createLead(fd({ name: "Visit Lead" }));
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Visit Lead" } });
    const r = await createSiteVisit(fd({ leadId: lead.id, siteAddress: "Plot 5, Thane", visitDate: "2030-02-01", estimatedArea: 1000 }));
    expect(r.ok).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("SITE_VISIT_SCHEDULED");
    const v = await db.siteVisit.findFirstOrThrow({ where: { leadId: lead.id } });
    expect((await completeSiteVisit(v.id)).ok).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("SITE_VISIT_COMPLETED");
  });

  it("requires a lead or client", async () => {
    await loginAs("sales@dsc.demo");
    const r = await createSiteVisit(fd({ siteAddress: "Somewhere", visitDate: "2030-02-01" }));
    expect(r.ok).toBe(false);
  });
});
