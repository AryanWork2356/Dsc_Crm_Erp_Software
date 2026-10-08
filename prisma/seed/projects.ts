import type { BoqCategory, PrismaClient, ProjectStatus, SegmentType, TaskStatus } from "@prisma/client";
import type { CoreSeed } from "./core";
import type { CrmSeed } from "./crm";

const day = (offset: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ProjectSeed = { projectIds: string[]; boqIds: string[] };

type Def = {
  clientIdx: number; quoteTitleLike?: string; name: string; segment: SegmentType; status: ProjectStatus; progress: number;
  start: number; end: number; pmIdx: number; address: string; cost: [number, number, number];
  tasks: [string, number, number, TaskStatus, number][]; // name, startOffset, dueOffset, status, progress
  manualLines?: [BoqCategory, string, string, number, number][];
};

const DEFS: Def[] = [
  {
    clientIdx: 0, quoteTitleLike: "3BHK", name: "Deshpande Residence – 3BHK Interior", segment: "RESIDENTIAL", status: "EXECUTION", progress: 55,
    start: -45, end: 35, pmIdx: 0, address: "Flat 1204, Lodha Splendora, Ghodbunder Road, Thane", cost: [0.54, 0.19, 0.05],
    tasks: [
      ["Site demolition & masonry", -45, -30, "COMPLETED", 100], ["Electrical & plumbing conduiting", -32, -18, "COMPLETED", 100],
      ["False ceiling framework", -20, -6, "COMPLETED", 100], ["Modular kitchen installation", -8, 10, "IN_PROGRESS", 60],
      ["Wardrobes & carpentry", -5, 18, "IN_PROGRESS", 45], ["Flooring", 5, 20, "TODO", 0], ["Painting & polish", 18, 30, "TODO", 0],
    ],
  },
  {
    clientIdx: 2, quoteTitleLike: "Retail store", name: "Bhatia Retail – Viviana Mall Store", segment: "RETAIL", status: "PROCUREMENT", progress: 15,
    start: -10, end: 60, pmIdx: 1, address: "Viviana Mall, Eastern Express Highway, Thane", cost: [0.52, 0.17, 0.05],
    tasks: [
      ["Layout & fixture drawings approval", -10, -3, "COMPLETED", 100], ["Order display wall units", -3, 7, "IN_PROGRESS", 40],
      ["Order lighting & ceiling material", -2, 10, "TODO", 0], ["Epoxy flooring", 20, 32, "TODO", 0], ["Fixture installation", 30, 50, "TODO", 0],
    ],
  },
  {
    clientIdx: 1, quoteTitleLike: "café", name: "Kapoor Hospitality – Boutique Café", segment: "HOTEL", status: "DESIGN", progress: 5,
    start: 10, end: 100, pmIdx: 0, address: "Hiranandani Estate, Thane West", cost: [0.55, 0.18, 0.04],
    tasks: [["Concept & 3D design", -5, 12, "IN_PROGRESS", 35], ["Client design sign-off", 12, 15, "TODO", 0], ["Kitchen & pantry planning", 14, 25, "TODO", 0]],
  },
  {
    clientIdx: 3, quoteTitleLike: "Dental", name: "Joshi Dental Clinic – Naupada", segment: "COMMERCIAL", status: "PLANNING", progress: 0,
    start: 25, end: 85, pmIdx: 1, address: "Naupada, Thane West", cost: [0.5, 0.2, 0.05],
    tasks: [["Site survey & measurements", 3, 7, "TODO", 0], ["Equipment layout with vendor", 8, 15, "TODO", 0]],
  },
  {
    clientIdx: 4, name: "Zenith Tech – Office Fit-out", segment: "CORPORATE", status: "COMPLETED", progress: 100,
    start: -150, end: -40, pmIdx: 0, address: "Wagle Estate, Thane", cost: [0.52, 0.18, 0.04],
    manualLines: [
      ["CIVIL", "Partition walls & civil", "lumpsum", 1, 420000], ["CARPENTRY", "Workstations (40 seats)", "nos", 40, 18500], ["FALSE_CEILING", "Grid ceiling", "sqft", 3200, 82],
      ["ELECTRICAL", "Structured cabling & power", "nos", 120, 1350], ["FLOORING", "Carpet tiles", "sqft", 3200, 110], ["PAINTING", "Emulsion paint", "sqft", 9000, 28],
    ],
    tasks: [["Civil & partitions", -150, -120, "COMPLETED", 100], ["Electrical & data", -125, -95, "COMPLETED", 100], ["Furniture installation", -90, -55, "COMPLETED", 100], ["Handover & snagging", -50, -40, "COMPLETED", 100]],
  },
];

export async function seedProjects(prisma: PrismaClient, core: CoreSeed, crm: CrmSeed): Promise<ProjectSeed> {
  const { companyId } = core;
  const existing = await prisma.project.findMany({ where: { companyId } });
  if (existing.length) return { projectIds: existing.map((p) => p.id), boqIds: (await prisma.boq.findMany({ where: { companyId } })).map((b) => b.id) };

  const pms = core.users.filter((u) => u.role === "PROJECT_MANAGER");
  const engineer = core.users.find((u) => u.role === "SITE_ENGINEER")!;
  const supervisor = core.users.find((u) => u.role === "SITE_SUPERVISOR")!;
  const designer = core.users.find((u) => u.role === "DESIGNER")!;

  const projectIds: string[] = [];
  const boqIds: string[] = [];
  let boqNo = 0;
  let taskNo = 0;

  for (let i = 0; i < DEFS.length; i++) {
    const d = DEFS[i];
    const pm = pms[d.pmIdx % pms.length];
    const quote = d.quoteTitleLike
      ? await prisma.quotation.findFirst({ where: { companyId, clientId: crm.clientIds[d.clientIdx], title: { contains: d.quoteTitleLike, mode: "insensitive" } }, include: { items: true } })
      : null;

    const lines = quote
      ? quote.items.map((it) => ({ category: it.category, item: it.description, unit: it.unit, qty: Number(it.quantity), rate: Number(it.rate) }))
      : d.manualLines!.map((l) => ({ category: l[0], item: l[1], unit: l[2], qty: l[3], rate: l[4] }));
    const revenue = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    const contractValue = quote ? round2(Number(quote.subtotal) - Number(quote.discountAmount)) : round2(revenue);

    const items = lines.map((l, idx) => {
      const mat = round2(l.rate * d.cost[0]);
      const lab = round2(l.rate * d.cost[1]);
      const oth = round2(l.rate * d.cost[2]);
      return { sortOrder: idx, category: l.category, item: l.item.slice(0, 160), unit: l.unit, quantity: l.qty, materialCost: mat, labourCost: lab, otherCost: oth, sellingRate: l.rate, estimatedCost: round2(l.qty * (mat + lab + oth)), total: round2(l.qty * l.rate) };
    });
    const budget = round2(items.reduce((s, it) => s + it.estimatedCost, 0));

    const project = await prisma.project.create({
      data: {
        companyId, code: `PRJ-${String(i + 1).padStart(5, "0")}`, name: d.name, clientId: crm.clientIds[d.clientIdx], segment: d.segment, siteAddress: d.address,
        startDate: day(d.start), plannedEndDate: day(d.end), actualEndDate: d.status === "COMPLETED" ? day(d.end + 3) : null,
        projectManagerId: pm.id, designerId: designer.id, siteEngineerId: i < 3 ? engineer.id : null, supervisorId: i < 3 ? supervisor.id : null,
        contractValue, budget, status: d.status, progress: d.progress, quotationId: quote?.id ?? null,
      },
    });
    projectIds.push(project.id);
    for (const [uid, label] of [[pm.id, "Project Manager"], [designer.id, "Designer"], ...(i < 3 ? [[engineer.id, "Site Engineer"], [supervisor.id, "Supervisor"]] : [])] as [string, string][]) {
      await prisma.projectMember.create({ data: { projectId: project.id, userId: uid, roleLabel: label } });
    }

    boqNo++;
    const boq = await prisma.boq.create({
      data: { companyId, number: `BOQ-${String(boqNo).padStart(5, "0")}`, projectId: project.id, quotationId: quote?.id, title: `${d.name} – BOQ`, status: d.status === "PLANNING" || d.status === "DESIGN" ? "DRAFT" : "APPROVED", items: { create: items } },
    });
    boqIds.push(boq.id);
    if (quote) await prisma.quotation.update({ where: { id: quote.id }, data: { projectId: project.id, boqId: boq.id } });

    const tasks: { id: string }[] = [];
    for (const t of d.tasks) {
      taskNo++;
      const row = await prisma.projectTask.create({
        data: {
          companyId, code: `TSK-${String(taskNo).padStart(5, "0")}`, projectId: project.id, name: t[0], startDate: day(t[1]), dueDate: day(t[2]), status: t[3], progress: t[4],
          assignedToId: (t[3] === "COMPLETED" || i < 3 ? [engineer.id, supervisor.id, pm.id][taskNo % 3] : pm.id),
          priority: t[2] < 0 && t[3] !== "COMPLETED" ? "HIGH" : "MEDIUM", dependsOnId: tasks.length ? tasks[tasks.length - 1].id : null,
        },
      });
      tasks.push(row);
    }

    const pcts = [30, 30, 30, 10];
    const names = ["Advance / mobilisation", "Carcass & civil complete", "Finishing complete", "Handover"];
    for (let m = 0; m < 4; m++) {
      const frac = (m + 1) / 4;
      const due = day(Math.round(d.start + (d.end - d.start) * frac));
      await prisma.projectMilestone.create({
        data: { companyId, projectId: project.id, name: names[m], dueDate: due, billingPct: pcts[m], completedAt: due < day(0) && d.status !== "PLANNING" && d.status !== "DESIGN" && m < Math.floor(d.progress / 25) + (d.status === "COMPLETED" ? 4 : 0) ? due : null },
      });
    }
  }
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "PRJ" } }, update: { value: DEFS.length }, create: { companyId, key: "PRJ", value: DEFS.length } });
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "BOQ" } }, update: { value: boqNo }, create: { companyId, key: "BOQ", value: boqNo } });
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "TSK" } }, update: { value: taskNo }, create: { companyId, key: "TSK", value: taskNo } });
  return { projectIds, boqIds };
}
