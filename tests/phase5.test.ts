import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { completeExtraWork, createExtraWork, recordClientDecision, sendExtraWork, startExtraWork } from "@/app/(app)/extra-work/actions";
import { respondToExtraWork } from "@/app/(portal)/portal/actions";
import { certifyVendorBill, createVendorBill, payVendorBill } from "@/app/(app)/finance/actions";
import { getTimeLimitItems } from "@/lib/time-limits";

beforeEach(() => logout());

const proj = (code: string) => db.project.findFirstOrThrow({ where: { code } });
const today = new Date().toISOString().slice(0, 10);
const proof = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], "approval.pdf", { type: "application/pdf" });

describe("extra work is locked until the client approves", () => {
  let awId = "";

  it("a supervisor can raise it, but cannot send it or start it", async () => {
    const p = await proj("PRJ-00001");
    await loginAs("supervisor@dsc.demo");
    const r = await createExtraWork(fd({ projectId: p.id, title: "Extra false-ceiling in passage", description: "Client asked on site", amount: 0 }));
    expect(r.ok).toBe(true);
    awId = (r as { data: { id: string } }).data.id;
    expect((await db.additionalWork.findUniqueOrThrow({ where: { id: awId } })).status).toBe("DRAFT");
    expect((await sendExtraWork(awId)).ok).toBe(false); // supervisors have no edit rights
    expect((await startExtraWork(awId)).ok).toBe(false);
  });

  it("cannot start while it is a draft or waiting for the client", async () => {
    await loginAs("pm@dsc.demo");
    const draft = await startExtraWork(awId);
    expect(draft.ok).toBe(false);
    expect((draft as { error: string }).error).toMatch(/Client approval is missing/);
    expect((await sendExtraWork(awId)).ok).toBe(false); // no cost yet
    await db.additionalWork.update({ where: { id: awId }, data: { amount: 85000 } });
    expect((await sendExtraWork(awId)).ok).toBe(true);
    expect((await db.additionalWork.findUniqueOrThrow({ where: { id: awId } })).status).toBe("SENT");
    const sent = await startExtraWork(awId);
    expect(sent.ok).toBe(false);
    expect((sent as { error: string }).error).toMatch(/Client approval is missing/);
    // the client was told
    const client = await db.user.findFirstOrThrow({ where: { email: "client@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: client.id, title: { contains: "approve extra work" } } })).toBeGreaterThan(0);
  });

  it("the client approves in their portal (only their own project), and only once", async () => {
    // client@dsc.demo owns PRJ-00001? use whichever client owns the project
    const p = await proj("PRJ-00001");
    const owner = await db.user.findFirst({ where: { role: "CLIENT", clientId: p.clientId } });
    const stranger = await db.user.findFirstOrThrow({ where: { role: "CLIENT", clientId: { not: p.clientId } } });
    await loginAs(stranger.email);
    expect((await respondToExtraWork(awId, true)).ok).toBe(false); // someone else's project
    expect((await db.additionalWork.findUniqueOrThrow({ where: { id: awId } })).status).toBe("SENT");

    expect(owner).toBeTruthy();
    await loginAs(owner!.email);
    expect((await respondToExtraWork(awId, true)).ok).toBe(true);
    const row = await db.additionalWork.findUniqueOrThrow({ where: { id: awId } });
    expect(row.status).toBe("APPROVED");
    expect(row.decisionVia).toBe("PORTAL");
    expect(row.decidedByName).toBe(owner!.name);
    expect((await respondToExtraWork(awId, true)).ok).toBe(false); // already answered
  });

  it("now it can start, and completing it tells Accounts to bill it", async () => {
    await loginAs("pm@dsc.demo");
    expect((await completeExtraWork(awId)).ok).toBe(false); // not started
    expect((await startExtraWork(awId)).ok).toBe(true);
    expect((await db.additionalWork.findUniqueOrThrow({ where: { id: awId } })).status).toBe("IN_PROGRESS");
    expect((await startExtraWork(awId)).ok).toBe(false); // already started
    expect((await completeExtraWork(awId)).ok).toBe(true);
    const acc = await db.user.findFirstOrThrow({ where: { email: "accounts@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: acc.id, title: { contains: "Extra work completed" } } })).toBeGreaterThan(0);
  });

  it("recording the client's written approval needs the proof; a refusal needs a reason", async () => {
    const p = await proj("PRJ-00001");
    await loginAs("pm@dsc.demo");
    const r = await createExtraWork(fd({ projectId: p.id, title: "Extra wardrobe", amount: 40000 }));
    const id = (r as { data: { id: string } }).data.id;
    expect((await recordClientDecision(id, true, fd({ decidedByName: "Mr. Deshpande" }))).ok).toBe(false); // no proof
    const withProof = fd({ decidedByName: "Mr. Deshpande", note: "Approved by e-mail" });
    withProof.append("proof", proof());
    expect((await recordClientDecision(id, true, withProof)).ok).toBe(true);
    const row = await db.additionalWork.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("APPROVED");
    expect(row.decisionVia).toBe("RECORDED");
    const doc = await db.document.findUniqueOrThrow({ where: { id: row.approvalDocId! } });
    expect(doc.entityId).toBe(p.id);
    expect((await startExtraWork(id)).ok).toBe(true);

    const r2 = await createExtraWork(fd({ projectId: p.id, title: "Extra mirror", amount: 9000 }));
    const id2 = (r2 as { data: { id: string } }).data.id;
    expect((await recordClientDecision(id2, false, fd({ decidedByName: "Mrs. Deshpande" }))).ok).toBe(false);
    expect((await recordClientDecision(id2, false, fd({ decidedByName: "Mrs. Deshpande", note: "Too costly" }))).ok).toBe(true);
    expect((await db.additionalWork.findUniqueOrThrow({ where: { id: id2 } })).status).toBe("REJECTED");
    expect((await startExtraWork(id2)).ok).toBe(false);
  });

  it("sales and clients' staff-side access: sales cannot raise extra work", async () => {
    const p = await proj("PRJ-00001");
    await loginAs("sales@dsc.demo");
    expect((await createExtraWork(fd({ projectId: p.id, title: "x", amount: 1 }))).ok).toBe(false);
  });
});

describe("vendor bills need the project manager's certification before payment", () => {
  const make = async (number: string, projectId?: string) => {
    await loginAs("accounts@dsc.demo");
    const v = await db.vendor.findFirstOrThrow({ where: { name: { startsWith: "Havells" } } });
    expect((await createVendorBill(fd({ vendorId: v.id, number, projectId, billDate: today, amount: 20000 }))).ok).toBe(true);
    return db.vendorBill.findFirstOrThrow({ where: { number } });
  };

  it("an uncertified bill cannot be paid; it needs the checkbox and the right person", async () => {
    const p = await proj("PRJ-00001"); // PM: pm@dsc.demo
    const bill = await make("CERT-1", p.id);
    expect(bill.certRequired).toBe(true);
    expect((await payVendorBill(fd({ billId: bill.id, amount: 5000, date: today }))).ok).toBe(false);

    await loginAs("accounts@dsc.demo");
    expect((await certifyVendorBill(bill.id, fd({ docsChecked: "on" }))).ok).toBe(false); // Accounts cannot certify
    await loginAs("pm2@dsc.demo");
    expect((await certifyVendorBill(bill.id, fd({ docsChecked: "on" }))).ok).toBe(false); // another project's PM
    await loginAs("pm@dsc.demo");
    expect((await certifyVendorBill(bill.id, fd({}))).ok).toBe(false); // must confirm documents
    expect((await certifyVendorBill(bill.id, fd({ docsChecked: "on", note: "Challan and measurements match" }))).ok).toBe(true);
    const fresh = await db.vendorBill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(fresh.certifiedAt).toBeTruthy();
    expect(fresh.certNote).toMatch(/Challan/);
    expect((await certifyVendorBill(bill.id, fd({ docsChecked: "on" }))).ok).toBe(false); // already certified

    await loginAs("accounts@dsc.demo");
    expect((await payVendorBill(fd({ billId: bill.id, amount: 5000, date: today }))).ok).toBe(true);
    const acc = await db.user.findFirstOrThrow({ where: { email: "accounts@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: acc.id, title: { contains: "CERT-1 certified" } } })).toBe(1);
  });

  it("a bill with no project is certified by Management, not a project manager", async () => {
    const bill = await make("CERT-2");
    await loginAs("pm@dsc.demo");
    expect((await certifyVendorBill(bill.id, fd({ docsChecked: "on" }))).ok).toBe(false);
    await loginAs("director@dsc.demo");
    expect((await certifyVendorBill(bill.id, fd({ docsChecked: "on" }))).ok).toBe(true);
  });

  it("old bills (before the rule) and the time-limit board", async () => {
    const p = await proj("PRJ-00001");
    const bill = await make("CERT-3", p.id);
    await db.vendorBill.update({ where: { id: bill.id }, data: { createdAt: new Date(Date.now() - 4 * 86400000) } });
    const items = await getTimeLimitItems(p.companyId);
    const hit = items.find((i) => i.ruleKey === "bill_certify" && i.id === bill.id);
    expect(hit?.state).toBe("overdue");
    const pm = await db.user.findFirstOrThrow({ where: { id: p.projectManagerId! } });
    expect(hit?.ownerIds).toContain(pm.id);
    await db.vendorBill.update({ where: { id: bill.id }, data: { certRequired: false } }); // legacy bills need no certification
    expect((await payVendorBill(fd({ billId: bill.id, amount: 1000, date: today }))).ok).toBe(true);
  });
});
