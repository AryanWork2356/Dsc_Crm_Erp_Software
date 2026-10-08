import type { LeadStage, PrismaClient, Priority, SegmentType } from "@prisma/client";
import type { CoreSeed } from "./core";

const day = (offset: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

export type CrmSeed = { clientIds: string[]; leadIds: string[] };

async function seq(prisma: PrismaClient, companyId: string, key: string, value: number) {
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key } }, update: { value }, create: { companyId, key, value } });
}

const CLIENTS = [
  { name: "Anil Deshpande", companyName: null, phone: "+91 98765 43210", email: "anil.d@example.com", address: "Flat 1204, Lodha Splendora, Ghodbunder Road, Thane", gstin: null, pan: null },
  { name: "Sneha Kapoor", companyName: "Kapoor Hospitality LLP", phone: "+91 98220 11223", email: "accounts@kapoorhospitality.example", address: "Hiranandani Estate, Thane West", gstin: "27AAKFK1234L1Z8", pan: "AAKFK1234L" },
  { name: "Rahul Bhatia", companyName: "Bhatia Retail Pvt Ltd", phone: "+91 99870 55667", email: "rahul@bhatiaretail.example", address: "Viviana Mall, Eastern Express Highway, Thane", gstin: "27AABCB5678M1Z2", pan: "AABCB5678M" },
  { name: "Dr. Meenal Joshi", companyName: "Joshi Dental Clinic", phone: "+91 97020 33445", email: "drmeenal@example.com", address: "Naupada, Thane West", gstin: null, pan: null },
  { name: "Farhan Sheikh", companyName: "Zenith Tech Solutions", phone: "+91 98190 77889", email: "farhan@zenithtech.example", address: "Wagle Estate, Thane", gstin: "27AAECZ9012N1Z5", pan: "AAECZ9012N" },
];

const LEADS: { name: string; companyName?: string; phone: string; source: string; segment: SegmentType; projectType: string; location: string; value: number; stage: LeadStage; priority: Priority; follow: number | null; owner: number; requirement: string }[] = [
  { name: "Vikas Naik", phone: "+91 98201 12345", source: "Instagram", segment: "RESIDENTIAL", projectType: "3BHK full interior", location: "Kolshet Road, Thane", value: 1850000, stage: "NEW", priority: "MEDIUM", follow: 0, owner: 0, requirement: "Complete modular kitchen, wardrobes, false ceiling and TV unit." },
  { name: "Pooja Sawant", phone: "+91 98202 23456", source: "Referral", segment: "RESIDENTIAL", projectType: "2BHK renovation", location: "Mulund West", value: 1200000, stage: "CONTACTED", priority: "HIGH", follow: -2, owner: 0, requirement: "Renovation of an old flat; flooring, painting, bathrooms." },
  { name: "Imran Qureshi", companyName: "Qureshi Cafe & Co.", phone: "+91 98203 34567", source: "Website", segment: "RETAIL", projectType: "Cafe fit-out 1200 sq ft", location: "Bandra West", value: 3400000, stage: "QUALIFIED", priority: "HIGH", follow: 1, owner: 1, requirement: "Cafe with custom counters, seating, lighting and signage." },
  { name: "Nitin Gokhale", companyName: "Gokhale Associates", phone: "+91 98204 45678", source: "Architect / Designer", segment: "CORPORATE", projectType: "Office 3500 sq ft", location: "Powai", value: 6200000, stage: "SITE_VISIT_SCHEDULED", priority: "URGENT", follow: 0, owner: 0, requirement: "Corporate office with cabins, workstations, conference room, pantry." },
  { name: "Ritu Malhotra", phone: "+91 98205 56789", source: "Google Ads", segment: "RESIDENTIAL", projectType: "4BHK luxury", location: "Worli", value: 9800000, stage: "SITE_VISIT_COMPLETED", priority: "HIGH", follow: 3, owner: 1, requirement: "Luxury residence; custom furniture, Italian marble, home automation." },
  { name: "Sachin Pillai", companyName: "Pillai Boutique Hotel", phone: "+91 98206 67890", source: "Exhibition", segment: "HOTEL", projectType: "Boutique hotel, 18 rooms", location: "Lonavala", value: 24000000, stage: "PROPOSAL_IN_PROGRESS", priority: "HIGH", follow: 2, owner: 0, requirement: "Rooms, lobby, restaurant. Turnkey with FF&E." },
  { name: "Deepa Menon", phone: "+91 98207 78901", source: "Referral", segment: "RESIDENTIAL", projectType: "3BHK", location: "Vashi, Navi Mumbai", value: 2100000, stage: "QUOTATION_SENT", priority: "MEDIUM", follow: -1, owner: 1, requirement: "Quotation sent; client comparing with two other firms." },
  { name: "Harshad Wagh", companyName: "Wagh Jewellers", phone: "+91 98208 89012", source: "Walk-in", segment: "RETAIL", projectType: "Jewellery showroom", location: "Dadar", value: 7500000, stage: "NEGOTIATION", priority: "URGENT", follow: 1, owner: 0, requirement: "Showroom with display fixtures, vault room, security lighting." },
  { name: "Kiran Desai", phone: "+91 98209 90123", source: "Facebook", segment: "RESIDENTIAL", projectType: "1BHK", location: "Dombivli", value: 650000, stage: "LOST", priority: "LOW", follow: null, owner: 1, requirement: "Budget too low for scope requested." },
  { name: "Anil Deshpande", phone: "+91 98765 43210", source: "Referral", segment: "RESIDENTIAL", projectType: "3BHK full interior", location: "Ghodbunder Road, Thane", value: 2800000, stage: "WON", priority: "HIGH", follow: null, owner: 0, requirement: "Converted to client. Full home interior." },
];

export async function seedCrm(prisma: PrismaClient, core: CoreSeed): Promise<CrmSeed> {
  const { companyId } = core;
  if ((await prisma.lead.count({ where: { companyId } })) > 0) {
    const [clients, leads] = await Promise.all([prisma.client.findMany({ where: { companyId } }), prisma.lead.findMany({ where: { companyId } })]);
    return { clientIds: clients.map((c) => c.id), leadIds: leads.map((l) => l.id) };
  }

  const sales = core.users.filter((u) => u.role === "SALES");
  const pms = core.users.filter((u) => u.role === "PROJECT_MANAGER");

  const clientIds: string[] = [];
  for (let i = 0; i < CLIENTS.length; i++) {
    const cl = await prisma.client.create({
      data: { companyId, code: `CL-${String(i + 1).padStart(5, "0")}`, ...CLIENTS[i], projectManagerId: pms[i % pms.length].id },
    });
    clientIds.push(cl.id);
  }
  await seq(prisma, companyId, "CL", CLIENTS.length);

  const leadIds: string[] = [];
  for (let i = 0; i < LEADS.length; i++) {
    const L = LEADS[i];
    const lead = await prisma.lead.create({
      data: {
        companyId, code: `LD-${String(i + 1).padStart(5, "0")}`, name: L.name, companyName: L.companyName, phone: L.phone, whatsapp: L.phone,
        email: `${L.name.split(" ")[0].toLowerCase()}@example.com`, source: L.source, segment: L.segment, projectType: L.projectType,
        location: L.location, estimatedValue: L.value, requirement: L.requirement, assignedToId: sales[L.owner % sales.length].id,
        stage: L.stage, priority: L.priority, nextFollowUp: L.follow === null ? null : day(L.follow),
        lostReason: L.stage === "LOST" ? "Budget too low for the requested scope" : null,
        clientId: L.stage === "WON" ? clientIds[0] : null, createdAt: day(-(LEADS.length - i) * 3),
      },
    });
    leadIds.push(lead.id);
    await prisma.leadActivity.createMany({
      data: [
        { companyId, leadId: lead.id, kind: "NOTE", body: "Lead created", userId: sales[L.owner % sales.length].id, createdAt: day(-(LEADS.length - i) * 3) },
        ...(L.stage !== "NEW" ? [{ companyId, leadId: lead.id, kind: "CALL", body: "Introductory call. Discussed requirement, budget and timeline.", userId: sales[L.owner % sales.length].id, createdAt: day(-(LEADS.length - i) * 3 + 1) }] : []),
      ],
    });
  }
  await seq(prisma, companyId, "LD", LEADS.length);

  // site visits
  await prisma.siteVisit.createMany({
    data: [
      { companyId, leadId: leadIds[3], siteAddress: "Hiranandani Business Park, Powai", visitDate: day(1), visitTime: "11:00", assignedToId: sales[0].id, estimatedArea: 3500, requirements: "Cabins x6, 40 workstations, conference room" },
      { companyId, leadId: leadIds[4], siteAddress: "Lodha World Towers, Worli", visitDate: day(-4), visitTime: "16:00", assignedToId: sales[1].id, estimatedArea: 3200, siteCondition: "Bare shell, MEP stubbed out", measurements: "Overall 3200 sq ft; ceiling height 10 ft", completed: true, followUpDate: day(3) },
      { companyId, leadId: leadIds[2], siteAddress: "Linking Road, Bandra West", visitDate: day(2), visitTime: "15:30", assignedToId: sales[1].id, estimatedArea: 1200 },
      { companyId, clientId: clientIds[0], siteAddress: "Lodha Splendora, Ghodbunder Road", visitDate: day(-20), assignedToId: sales[0].id, estimatedArea: 1450, completed: true },
    ],
  });

  // welcome notifications so the bell isn't empty
  const notify = [...sales, ...core.users.filter((u) => u.role === "OWNER" || u.role === "MANAGEMENT")];
  await prisma.notification.createMany({
    data: notify.map((u) => ({ companyId, userId: u.id, type: "FOLLOW_UP" as const, title: "Follow-ups due today", body: "Check the Follow-ups page for leads that need a call.", link: "/crm/follow-ups" })),
  });

  return { clientIds, leadIds };
}
