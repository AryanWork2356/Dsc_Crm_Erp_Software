import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { DocumentType, PrismaClient } from "@prisma/client";
import type { CoreSeed } from "./core";
import type { CrmSeed } from "./crm";
import type { ProjectSeed } from "./projects";

const day = (offset: number) => {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

// 1×1 PNG and a minimal valid one-page PDF (real files so download/preview can be demonstrated)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const pdf = (title: string) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${44 + title.length}>>stream\nBT /F1 14 Tf 20 60 Td (${title}) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`);

export async function seedExtras(prisma: PrismaClient, core: CoreSeed, crm: CrmSeed, proj: ProjectSeed) {
  const { companyId } = core;
  if ((await prisma.supportTicket.count({ where: { companyId } })) > 0) return;
  const projects = await prisma.project.findMany({ where: { id: { in: proj.projectIds } }, orderBy: { code: "asc" } });
  const pm = core.users.find((u) => u.role === "PROJECT_MANAGER")!;
  const engineer = core.users.find((u) => u.role === "SITE_ENGINEER")!;
  const sales = core.users.find((u) => u.role === "SALES")!;
  const admin = core.users.find((u) => u.role === "ADMIN")!;

  // support tickets – the completed project (PRJ-00005, Zenith) is still inside its 12-month warranty
  const done = projects[4];
  const t = [
    { n: 1, p: projects[0], subject: "Kitchen drawer not closing smoothly", priority: "MEDIUM" as const, status: "IN_PROGRESS" as const, warranty: false, ago: 5, assignee: engineer.id },
    { n: 2, p: done, subject: "Workstation laminate peeling at edge", priority: "HIGH" as const, status: "ASSIGNED" as const, warranty: true, ago: 3, assignee: pm.id },
    { n: 3, p: done, subject: "False ceiling panel stained after AC leak", priority: "URGENT" as const, status: "OPEN" as const, warranty: true, ago: 1, assignee: null },
    { n: 4, p: done, subject: "Pantry cabinet hinge replacement", priority: "LOW" as const, status: "RESOLVED" as const, warranty: true, ago: 20, assignee: engineer.id },
  ];
  for (const x of t) {
    const tk = await prisma.supportTicket.create({
      data: {
        companyId, number: `TKT-${String(x.n).padStart(5, "0")}`, clientId: x.p.clientId, projectId: x.p.id, subject: x.subject, description: "Reported by the client on call. Photos attached on the ticket.",
        priority: x.priority, isWarranty: x.warranty, assignedToId: x.assignee, status: x.status, createdAt: day(-x.ago),
        resolution: x.status === "RESOLVED" ? "Replaced two soft-close hinges and re-aligned the shutter. Client confirmed." : null,
      },
    });
    if (x.warranty && x.n !== 3) await prisma.warrantyClaim.create({ data: { companyId, ticketId: tk.id, item: x.n === 4 ? "Soft-close hinges ×2" : "Laminate re-pasting – 6 workstations", approved: x.n === 4 ? true : null } });
  }
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "TKT" } }, update: { value: t.length }, create: { companyId, key: "TKT", value: t.length } });

  // marketing campaigns (channel names match lead sources)
  await prisma.marketingCampaign.createMany({
    data: [
      { companyId, name: "Instagram reels – modular kitchens", channel: "Instagram", startDate: day(-45), endDate: day(-5), spend: 38000, notes: "6 reels + paid boost" },
      { companyId, name: "Google Ads – 'interior designer Thane'", channel: "Google Ads", startDate: day(-30), endDate: day(15), spend: 52000 },
      { companyId, name: "Facebook lead form – 2BHK renovation", channel: "Facebook", startDate: day(-20), endDate: day(10), spend: 21000 },
      { companyId, name: "Home & Decor expo stall", channel: "Exhibition", startDate: day(-60), endDate: day(-58), spend: 85000, notes: "3-day stall at Mumbai" },
    ],
  });

  // WhatsApp conversations
  const leads = await prisma.lead.findMany({ where: { companyId }, orderBy: { code: "asc" }, take: 3 });
  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    const phone = (l.whatsapp ?? l.phone ?? "").replace(/\D/g, "");
    const conv = await prisma.whatsAppConversation.create({ data: { companyId, phone: phone.length === 10 ? `91${phone}` : phone, contactName: l.name, leadId: l.id, assignedToId: l.assignedToId, unread: i === 0 ? 2 : 0, lastMessageAt: day(-i) } });
    await prisma.whatsAppMessage.createMany({
      data: [
        { conversationId: conv.id, direction: "INBOUND", body: `Hi, I saw your reel. We're looking for interiors for our new flat in ${l.location ?? "Thane"}.`, status: "RECEIVED", createdAt: new Date(day(-i).getTime() - 3600000 * 5) },
        { conversationId: conv.id, direction: "OUTBOUND", body: `Hi ${l.name.split(" ")[0]}, thank you for contacting DSC Interior! Could we visit the site this week?`, status: "READ", template: "lead_ack", sentById: sales.id, createdAt: new Date(day(-i).getTime() - 3600000 * 4) },
        ...(i === 0 ? [{ conversationId: conv.id, direction: "INBOUND" as const, body: "Yes, Saturday morning works. Is a ₹18-20 lakh budget realistic for a full 3BHK?", status: "RECEIVED", createdAt: day(-i) }, { conversationId: conv.id, direction: "INBOUND" as const, body: "Also, do you do modular kitchens in-house?", status: "RECEIVED", createdAt: new Date(day(-i).getTime() + 60000) }] : []),
        ...(i === 1 ? [{ conversationId: conv.id, direction: "NOTE" as const, body: "Client is comparing with two other firms – send the portfolio PDF and offer a free 3D render.", status: "NOTE", sentById: sales.id, createdAt: day(-i) }] : []),
      ],
    });
  }

  // documents (real files on disk through the same layout the storage module uses)
  const root = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
  const put = async (bytes: Buffer, ext: string) => {
    const key = `${companyId}/${crypto.randomUUID()}.${ext}`;
    await fs.mkdir(path.dirname(path.join(root, key)), { recursive: true });
    await fs.writeFile(path.join(root, key), bytes);
    return key;
  };
  const docs: [string, DocumentType, string, string, string, number, boolean, number | null][] = [
    ["Floor plan – Rev 1.pdf", "FLOOR_PLAN", "PROJECT", projects[0].id, "pdf", 1, true, null],
    ["Floor plan – Rev 1.pdf", "FLOOR_PLAN", "PROJECT", projects[0].id, "pdf", 2, true, null],
    ["Signed contract.pdf", "CONTRACT", "PROJECT", projects[0].id, "pdf", 1, false, null],
    ["Kitchen site photo – carcass done.png", "SITE_PHOTO", "PROJECT", projects[0].id, "png", 1, true, null],
    ["Warranty certificate.pdf", "WARRANTY", "PROJECT", done.id, "pdf", 1, true, 340],
    ["Client GST certificate.pdf", "GST", "CLIENT", crm.clientIds[2], "pdf", 1, false, 20],
  ];
  for (const [name, type, entityType, entityId, ext, version, shared, expires] of docs) {
    const bytes = ext === "png" ? PNG : pdf(name.replace(/[()\\]/g, ""));
    await prisma.document.create({ data: { companyId, name, type, folder: entityType === "PROJECT" ? "Project files" : "KYC", entityType, entityId, storageKey: await put(bytes, ext), mimeType: ext === "png" ? "image/png" : "application/pdf", size: bytes.length, version, isPortalVisible: shared, expiresAt: expires === null ? null : day(expires), uploadedById: admin.id, tags: type === "SITE_PHOTO" ? "site, kitchen" : null } });
  }
}

/** Portal logins + worker tasks. Idempotent, and runs on every seed so existing databases get them too. */
export async function seedPortal(prisma: PrismaClient, core: CoreSeed, crm: CrmSeed, proj: ProjectSeed, passwordHash: string) {
  const { companyId } = core;
  const projects = await prisma.project.findMany({ where: { id: { in: proj.projectIds } }, orderBy: { code: "asc" } });
  // the first client (Deshpande), the plywood vendor, and tasks for the demo worker
  const vendor = await prisma.vendor.findFirst({ where: { companyId, name: { startsWith: "Greenply" } } });
  await prisma.user.upsert({ where: { companyId_email: { companyId, email: "client@dsc.demo" } }, update: {}, create: { companyId, email: "client@dsc.demo", name: "Anil Deshpande", role: "CLIENT", clientId: crm.clientIds[0], passwordHash } });
  if (vendor) await prisma.user.upsert({ where: { companyId_email: { companyId, email: "vendor@dsc.demo" } }, update: {}, create: { companyId, email: "vendor@dsc.demo", name: "Greenply Distributors", role: "VENDOR", vendorId: vendor.id, passwordHash } });
  const w1 = await prisma.worker.findFirst({ where: { companyId, code: "W-00001" } });
  if (w1) {
    const tasks = await prisma.projectTask.findMany({ where: { projectId: projects[0].id, status: { in: ["IN_PROGRESS", "TODO"] } }, orderBy: { dueDate: "asc" }, take: 2 });
    for (const t of tasks) await prisma.projectTask.update({ where: { id: t.id }, data: { workerId: w1.id } });
  }
  // the client's quotation has been sent to them, so the portal has something to show
  const sent = await prisma.quotation.findFirst({ where: { companyId, clientId: crm.clientIds[2], status: "SENT" } });
  if (sent) await prisma.user.upsert({ where: { companyId_email: { companyId, email: "bhatia@dsc.demo" } }, update: {}, create: { companyId, email: "bhatia@dsc.demo", name: "Rahul Bhatia", role: "CLIENT", clientId: crm.clientIds[2], passwordHash } });
}
