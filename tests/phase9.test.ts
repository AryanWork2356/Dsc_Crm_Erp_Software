import crypto from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { uploadDocument, deleteDocument } from "@/app/(app)/documents/actions";
import { GET as downloadDoc } from "@/app/(app)/documents/[id]/download/route";
import { createTicket, setTicketStatus, addWarrantyClaim, decideWarrantyClaim } from "@/app/(app)/support/actions";
import { saveWhatsAppConfig, sendMessage, startConversation } from "@/app/(app)/whatsapp/actions";
import { GET as waVerify, POST as waHook } from "@/app/api/whatsapp/webhook/route";
import { normalizePhone, renderTemplate, loadWaConfig } from "@/lib/whatsapp";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { runDailyAutomations } from "@/lib/automation";
import { validateUpload, UploadError } from "@/lib/storage";
import { createCampaign } from "@/app/(app)/marketing/actions";
import { POST as cronPost } from "@/app/api/cron/daily/route";
import { GET as healthGet } from "@/app/api/health/route";

beforeEach(() => logout());

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const file = (bytes: Buffer | string, name: string) => new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name);
const upload = (c: Record<string, string>, f: File) => { const x = fd(c); x.set("file", f); return uploadDocument(x); };
const proj = (code: string) => db.project.findFirstOrThrow({ where: { code } });
const dl = (id: string) => downloadDoc(new NextRequest(`http://localhost/documents/${id}/download`), { params: Promise.resolve({ id }) });

describe("secrets", () => {
  it("encrypts and decrypts, and refuses tampered values", () => {
    const enc = encryptSecret("EAAG-token");
    expect(enc).not.toContain("EAAG");
    expect(decryptSecret(enc)).toBe("EAAG-token");
    expect(decryptSecret(enc.slice(0, -4) + "AAAA")).toBe("");
    expect(decryptSecret("")).toBe("");
  });
});

describe("file upload validation", () => {
  it("accepts a real PDF and rejects wrong extensions, spoofed contents, empty and oversized files", async () => {
    expect((await validateUpload(file(PDF, "plan.pdf"))).ext).toBe("pdf");
    await expect(validateUpload(file(PDF, "virus.exe"))).rejects.toBeInstanceOf(UploadError);
    await expect(validateUpload(file("<html><script>alert(1)</script></html>", "page.html"))).rejects.toBeInstanceOf(UploadError);
    await expect(validateUpload(file("MZ-not-a-pdf", "fake.pdf"))).rejects.toThrow(/don't match/);
    await expect(validateUpload(file("", "empty.pdf"))).rejects.toBeInstanceOf(UploadError);
    await expect(validateUpload(file(Buffer.alloc(11 * 1024 * 1024, 1), "big.csv"))).rejects.toThrow(/too large/);
  });
});

describe("documents", () => {
  let docId = "";
  it("uploads to a project, then a same-name upload becomes version 2", async () => {
    await loginAs("pm@dsc.demo");
    const p = await proj("PRJ-00001");
    expect((await upload({ entityType: "PROJECT", entityId: p.id, name: "Layout test.pdf", type: "DRAWING" }, file(PDF, "layout.pdf"))).ok).toBe(true);
    expect((await upload({ entityType: "PROJECT", entityId: p.id, name: "layout test.pdf", type: "DRAWING" }, file(PDF, "layout.pdf"))).ok).toBe(true);
    const docs = await db.document.findMany({ where: { name: { equals: "Layout test.pdf", mode: "insensitive" } }, orderBy: { version: "asc" } });
    expect(docs.map((d) => d.version)).toEqual([1, 2]);
    docId = docs[1].id;
  });

  it("serves the file to people with access with safe headers; denies others with 404", async () => {
    await loginAs("director@dsc.demo");
    const ok = await dl(docId);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    await loginAs("pm2@dsc.demo"); // Kavita doesn't manage PRJ-00001
    expect((await dl(docId)).status).toBe(404);
    await loginAs("store@dsc.demo");
    expect((await dl(docId)).status).toBe(404);
    logout();
    expect((await dl(docId)).status).toBe(401);
  });

  it("cannot attach files to records you can't see, or upload with the wrong permission", async () => {
    await loginAs("pm2@dsc.demo");
    const p1 = await proj("PRJ-00001");
    expect((await upload({ entityType: "PROJECT", entityId: p1.id }, file(PDF, "x.pdf"))).ok).toBe(false);
    await loginAs("supervisor@dsc.demo");
    expect((await upload({ entityType: "EMPLOYEE", entityId: (await db.employee.findFirstOrThrow()).id }, file(PDF, "salary.pdf"))).ok).toBe(false);
  });

  it("employee documents are visible to HR but not to colleagues", async () => {
    await loginAs("hr@dsc.demo");
    const emp = await db.employee.findFirstOrThrow({ where: { email: "sales@dsc.demo" } });
    expect((await upload({ entityType: "EMPLOYEE", entityId: emp.id, name: "Aadhaar test.pdf", type: "ID_PROOF" }, file(PDF, "a.pdf"))).ok).toBe(true);
    const d = await db.document.findFirstOrThrow({ where: { name: "Aadhaar test.pdf" } });
    expect((await dl(d.id)).status).toBe(200);
    await loginAs("sales2@dsc.demo");
    expect((await dl(d.id)).status).toBe(404);
  });

  it("only the uploader or an admin can remove a file; removal is a soft delete", async () => {
    await loginAs("sales@dsc.demo");
    expect((await deleteDocument(docId)).ok).toBe(false);
    await loginAs("pm@dsc.demo");
    expect((await deleteDocument(docId)).ok).toBe(true);
    expect((await db.document.findUniqueOrThrow({ where: { id: docId } })).deletedAt).not.toBeNull();
    await loginAs("director@dsc.demo");
    expect((await dl(docId)).status).toBe(404);
  });

  it("blocks path traversal in storage keys", async () => {
    const { getFile } = await import("@/lib/storage");
    await expect(getFile("../../.env")).rejects.toThrow(/Invalid storage key/);
  });
});

describe("support tickets and warranty", () => {
  it("detects warranty from the handover date and assigns the project manager", async () => {
    await loginAs("sales@dsc.demo");
    const done = await proj("PRJ-00005"); // completed ~40 days ago → in warranty
    const active = await proj("PRJ-00001");
    expect((await createTicket(fd({ clientId: done.clientId, projectId: done.id, subject: "Warranty test issue" }))).ok).toBe(false); // sales lacks support:create
    await loginAs("pm@dsc.demo");
    expect((await createTicket(fd({ clientId: done.clientId, projectId: done.id, subject: "Warranty test issue", priority: "HIGH" }))).ok).toBe(true);
    expect((await createTicket(fd({ clientId: active.clientId, projectId: active.id, subject: "Not-yet-handed-over issue" }))).ok).toBe(true);
    const w = await db.supportTicket.findFirstOrThrow({ where: { subject: "Warranty test issue" } });
    expect(w.isWarranty).toBe(true);
    expect(w.assignedToId).toBe(done.projectManagerId);
    expect(w.status).toBe("ASSIGNED");
    expect((await db.supportTicket.findFirstOrThrow({ where: { subject: "Not-yet-handed-over issue" } })).isWarranty).toBe(false);
    expect((await createTicket(fd({ clientId: active.clientId, projectId: done.id, subject: "Mismatch" }))).ok).toBe(false); // project belongs to another client
  });

  it("resolution is mandatory, status moves follow the allowed flow, closed tickets can reopen", async () => {
    await loginAs("director@dsc.demo");
    const t = await db.supportTicket.findFirstOrThrow({ where: { subject: "Warranty test issue" } });
    expect((await setTicketStatus(t.id, "CLOSED")).ok).toBe(false); // not allowed straight from assigned
    expect((await setTicketStatus(t.id, "RESOLVED", fd({ resolution: "" }))).ok).toBe(false);
    expect((await setTicketStatus(t.id, "IN_PROGRESS")).ok).toBe(true);
    expect((await setTicketStatus(t.id, "RESOLVED", fd({ resolution: "Re-pasted laminate" }))).ok).toBe(true);
    expect((await setTicketStatus(t.id, "CLOSED")).ok).toBe(true);
    expect((await setTicketStatus(t.id, "IN_PROGRESS")).ok).toBe(true);
  });

  it("warranty claims: only on warranty tickets; declining needs a reason; decided once", async () => {
    await loginAs("director@dsc.demo");
    const w = await db.supportTicket.findFirstOrThrow({ where: { subject: "Warranty test issue" } });
    const n = await db.supportTicket.findFirstOrThrow({ where: { subject: "Not-yet-handed-over issue" } });
    expect((await addWarrantyClaim(n.id, fd({ item: "x" }))).ok).toBe(false);
    expect((await addWarrantyClaim(w.id, fd({ item: "Laminate re-pasting" }))).ok).toBe(true);
    const claim = await db.warrantyClaim.findFirstOrThrow({ where: { ticketId: w.id } });
    expect((await decideWarrantyClaim(claim.id, false, fd({ notes: "" }))).ok).toBe(false);
    expect((await decideWarrantyClaim(claim.id, true)).ok).toBe(true);
    expect((await decideWarrantyClaim(claim.id, false, fd({ notes: "late" }))).ok).toBe(false); // already decided
    expect((await db.warrantyClaim.findUniqueOrThrow({ where: { id: claim.id } })).approved).toBe(true);
  });
});

describe("whatsapp", () => {
  it("normalises Indian numbers and renders templates", () => {
    expect(normalizePhone("98200 12345")).toBe("919820012345");
    expect(normalizePhone("+91 98200-12345")).toBe("919820012345");
    expect(normalizePhone("09820012345")).toBe("919820012345");
    expect(renderTemplate("payment_reminder", { name: "Rahul", number: "INV-1", amount: "50,000", date: "5 Nov", company: "DSC" })).toContain("INV-1");
    expect(renderTemplate("lead_ack", { company: "DSC" })).toContain("{{name}}"); // missing variable stays visible so it can be caught
  });

  it("without credentials a message is stored as not delivered, never silently lost", async () => {
    await loginAs("sales@dsc.demo");
    const r = await startConversation(fd({ phone: "98200 99999", name: "Test Customer" }));
    expect(r.ok).toBe(true);
    const conv = await db.whatsAppConversation.findFirstOrThrow({ where: { contactName: "Test Customer" } });
    expect(conv.phone).toBe("919820099999");
    const sent = await sendMessage(conv.id, fd({ body: "Hello from DSC" }));
    expect(sent.ok).toBe(false);
    const m = await db.whatsAppMessage.findFirstOrThrow({ where: { conversationId: conv.id, direction: "OUTBOUND" } });
    expect(m.status).toBe("FAILED");
    expect((await sendMessage(conv.id, fd({ body: "Reminder for the team", note: "on" }))).ok).toBe(true);
    expect((await db.whatsAppMessage.findFirstOrThrow({ where: { conversationId: conv.id, direction: "NOTE" } })).body).toContain("Reminder");
  });

  it("only owner/admin can save credentials, and secrets are stored encrypted", async () => {
    await loginAs("sales@dsc.demo");
    expect((await saveWhatsAppConfig(fd({ enabled: "on", phoneNumberId: "123", accessToken: "tok" }))).ok).toBe(false);
    await loginAs("owner@dsc.demo");
    expect((await saveWhatsAppConfig(fd({ enabled: "on", phoneNumberId: "1055550001", accessToken: "EAAG-secret-token", appSecret: "app-secret-xyz", verifyToken: "verify-me" }))).ok).toBe(true);
    const row = await db.companySettings.findFirstOrThrow();
    const raw = JSON.stringify(row.whatsappConfig);
    expect(raw).not.toContain("EAAG-secret-token");
    expect(raw).not.toContain("app-secret-xyz");
    const cfg = await loadWaConfig(row.companyId);
    expect(cfg.accessToken).toBe("EAAG-secret-token");
    expect((await saveWhatsAppConfig(fd({ enabled: "on", phoneNumberId: "abc" }))).ok).toBe(false);
  });

  it("webhook: verify handshake, rejects forged/unsigned posts, ingests signed inbound messages once", async () => {
    const good = await waVerify(new NextRequest("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123"));
    expect(good.status).toBe(200);
    expect(await good.text()).toBe("abc123");
    expect((await waVerify(new NextRequest("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=x"))).status).toBe(403);

    const lead = await db.lead.findFirstOrThrow({ where: { name: "Vikas Naik" } });
    const phone = "91" + (lead.phone ?? "").replace(/\D/g, "").slice(-10);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1055550001" }, contacts: [{ wa_id: phone, profile: { name: "Vikas" } }], messages: [{ id: "wamid.TEST1", from: phone, type: "text", text: { body: "Is Saturday okay for the visit?" } }] } }] }] });
    const sign = (b: string, secret = "app-secret-xyz") => "sha256=" + crypto.createHmac("sha256", secret).update(b).digest("hex");
    const post = (b: string, sig?: string) => waHook(new NextRequest("http://localhost/api/whatsapp/webhook", { method: "POST", body: b, headers: sig ? { "x-hub-signature-256": sig } : {} }));

    expect((await post(body)).status).toBe(401); // unsigned
    expect((await post(body, sign(body, "wrong-secret"))).status).toBe(401); // forged
    expect(await db.whatsAppMessage.count({ where: { externalId: "wamid.TEST1" } })).toBe(0);
    expect((await post(body, sign(body))).status).toBe(200);
    expect((await post(body, sign(body))).status).toBe(200); // Meta retry → no duplicate
    const msgs = await db.whatsAppMessage.findMany({ where: { externalId: "wamid.TEST1" }, include: { conversation: true } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].direction).toBe("INBOUND");
    expect(msgs[0].conversation.leadId).toBe(lead.id); // matched to the lead by phone number
    expect(msgs[0].conversation.unread).toBeGreaterThan(0);
    const owner = await db.user.findUniqueOrThrow({ where: { id: lead.assignedToId! } });
    expect(await db.notification.count({ where: { userId: owner.id, title: "New WhatsApp message" } })).toBeGreaterThan(0);
  });
});

describe("marketing", () => {
  it("only roles with marketing rights can add campaigns; end can't precede start", async () => {
    await loginAs("designer@dsc.demo");
    expect((await createCampaign(fd({ name: "x", channel: "Instagram" }))).ok).toBe(false);
    await loginAs("director@dsc.demo");
    expect((await createCampaign(fd({ name: "Bad dates", channel: "Instagram", startDate: "2030-05-01", endDate: "2030-04-01" }))).ok).toBe(false);
    expect((await createCampaign(fd({ name: "Good", channel: "Instagram", spend: 1000 }))).ok).toBe(true);
  });
});

describe("daily automation", () => {
  it("marks unpaid overdue invoices, notifies the right people, and never duplicates on re-run", async () => {
    const companyId = (await db.company.findFirstOrThrow()).id;
    const before = await db.notification.count();
    const r1 = await runDailyAutomations(companyId);
    expect(r1.invoicesOverdue).toBeGreaterThan(0);
    expect(r1.followUpUsersNotified).toBeGreaterThan(0);
    expect(r1.latePurchaseOrders).toBeGreaterThan(0);
    const overdue = await db.invoice.findMany({ where: { status: "OVERDUE" } });
    expect(overdue.length).toBeGreaterThan(0);
    expect(overdue.every((i) => Number(i.paid) === 0)).toBe(true);
    const mid = await db.notification.count();
    expect(mid).toBeGreaterThan(before);
    const accounts = await db.user.findFirstOrThrow({ where: { email: "accounts@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: accounts.id, type: "INVOICE_OVERDUE" } })).toBeGreaterThan(0);

    await runDailyAutomations(companyId);
    await runDailyAutomations(companyId);
    expect(await db.notification.count()).toBe(mid); // idempotent
    const settings = await db.companySettings.findFirstOrThrow();
    expect((settings.notificationPrefs as { lastDailyRun?: string }).lastDailyRun).toBeTruthy();
  });

  it("marks a sent quotation expired once its validity date has passed", async () => {
    const companyId = (await db.company.findFirstOrThrow()).id;
    const base = await db.quotation.findFirstOrThrow({ where: { status: "DRAFT" } }); // own fixture – independent of other tests
    const q = await db.quotation.create({ data: { companyId, number: "QT-EXPIRE-1", clientId: base.clientId, status: "SENT", validUntil: new Date(Date.now() - 3 * 86400000), total: 1000 } });
    const r = await runDailyAutomations(companyId);
    expect(r.quotationsExpired).toBeGreaterThanOrEqual(1);
    expect((await db.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("EXPIRED");
  });
});

describe("scheduler endpoint and health check", () => {
  const call = (auth?: string) => cronPost(new NextRequest("http://localhost/api/cron/daily", { method: "POST", headers: auth ? { authorization: auth } : {} }));
  it("refuses everything without the exact CRON_SECRET, and runs with it", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything-at-all-123456")).status).toBe(401); // disabled when no secret is configured
    process.env.CRON_SECRET = "cron-secret-1234567890";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-secret-0123456789")).status).toBe(401);
    expect((await call("Bearer short")).status).toBe(401);
    const ok = await call("Bearer cron-secret-1234567890");
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
    delete process.env.CRON_SECRET;
  });
  it("health endpoint reports the database is reachable", async () => {
    const r = await healthGet();
    expect(r.status).toBe(200);
  });
});
