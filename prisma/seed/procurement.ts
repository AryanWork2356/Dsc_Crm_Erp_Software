import type { BoqCategory, PrismaClient, PoStatus, Vendor } from "@prisma/client";
import type { CoreSeed } from "./core";
import type { ProjectSeed } from "./projects";
import { computeTotals } from "../../src/lib/money";

const day = (offset: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

const VENDORS = [
  { name: "Greenply Distributors", contactPerson: "Suresh Agarwal", phone: "+91 98330 11001", email: "orders@greenplydist.example", gstin: "27AAACG1234F1Z5", categories: "Plywood, laminates, MDF, edge band", rating: 5, address: "Bhiwandi Godown Complex, Thane" },
  { name: "Hettich Hardware Mart", contactPerson: "Rakesh Jain", phone: "+91 98330 11002", email: "sales@hardwaremart.example", gstin: "27AABCH5678G1Z2", categories: "Hinges, channels, handles, locks", rating: 4, address: "Lohar Chawl, Mumbai" },
  { name: "Havells Electricals (Thane)", contactPerson: "Pradeep Naik", phone: "+91 98330 11003", email: "thane@electricals.example", gstin: "27AACCH9012H1Z9", categories: "Wires, switches, MCBs, lighting", rating: 4, address: "Naupada, Thane West" },
  { name: "Kajaria Tiles Gallery", contactPerson: "Manoj Shetty", phone: "+91 98330 11004", email: "gallery@tilesgallery.example", gstin: "27AADCK3456J1Z4", categories: "Vitrified tiles, marble, adhesives", rating: 3, address: "Ghodbunder Road, Thane" },
  { name: "Asian Colour Traders", contactPerson: "Imtiyaz Khan", phone: "+91 98330 11005", email: "supply@colourtraders.example", gstin: "27AAECA7890K1Z1", categories: "Paints, putty, primer, polish", rating: 5, address: "Mulund West, Mumbai" },
];

// name, category, unit, cost, min, reorder, vendorIdx, opening stock
const MATERIALS: [string, BoqCategory, string, number, number, number, number, number][] = [
  ["Plywood 18mm BWP (8x4)", "CARPENTRY", "sheet", 2850, 20, 40, 0, 85],
  ["Plywood 12mm BWP (8x4)", "CARPENTRY", "sheet", 2050, 15, 30, 0, 60],
  ["Laminate 1mm (8x4)", "CARPENTRY", "sheet", 1250, 20, 40, 0, 120],
  ["Edge band 1mm roll", "CARPENTRY", "rft", 7, 500, 1000, 0, 4200],
  ["MDF board 18mm (8x4)", "CARPENTRY", "sheet", 1650, 10, 20, 0, 30],
  ["Soft-close hinge pair", "HARDWARE", "nos", 185, 100, 200, 1, 640],
  ["Telescopic channel 18in", "HARDWARE", "pair", 240, 60, 120, 1, 310],
  ["Profile handle 3ft", "HARDWARE", "nos", 340, 40, 80, 1, 150],
  ["Wire 2.5 sqmm FR (90m)", "ELECTRICAL", "coil", 2650, 10, 20, 2, 36],
  ["Modular switch plate 6M", "ELECTRICAL", "nos", 410, 40, 80, 2, 180],
  ["MCB 16A SP", "ELECTRICAL", "nos", 285, 30, 60, 2, 95],
  ["LED panel 2x2 36W", "LIGHTING", "nos", 1250, 20, 40, 2, 70],
  ["Vitrified tile 800x800", "FLOORING", "box", 1480, 40, 80, 3, 210],
  ["Tile adhesive 20kg", "FLOORING", "bag", 420, 40, 80, 3, 150],
  ["Gypsum board 12.5mm", "FALSE_CEILING", "sheet", 395, 60, 120, 0, 240],
  ["GI channel 3m", "FALSE_CEILING", "nos", 118, 100, 200, 0, 520],
  ["Emulsion paint 20L", "PAINTING", "bucket", 6200, 10, 20, 4, 34],
  ["Wall putty 20kg", "PAINTING", "bag", 780, 30, 60, 4, 110],
  ["Primer 20L", "PAINTING", "bucket", 3100, 8, 16, 4, 12],
  ["Fevicol SH 5kg", "CARPENTRY", "nos", 960, 12, 24, 1, 14],
];

export async function seedProcurement(prisma: PrismaClient, core: CoreSeed, proj: ProjectSeed) {
  const { companyId } = core;
  if ((await prisma.vendor.count({ where: { companyId } })) > 0) return;
  const store = core.users.find((u) => u.role === "STORE")!;
  const proc = core.users.find((u) => u.role === "PROCUREMENT")!;
  const pmUser = core.users.find((u) => u.role === "PROJECT_MANAGER")!;
  const engineer = core.users.find((u) => u.role === "SITE_ENGINEER")!;

  const vendors: Vendor[] = [];
  for (let i = 0; i < VENDORS.length; i++) vendors.push(await prisma.vendor.create({ data: { companyId, code: `V-${String(i + 1).padStart(5, "0")}`, ...VENDORS[i] } }));
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "V" } }, update: { value: vendors.length }, create: { companyId, key: "V", value: vendors.length } });

  const main = await prisma.warehouse.create({ data: { companyId, name: "Thane Main Warehouse", type: "WAREHOUSE", address: "Kolshet Industrial Area, Thane" } });
  await prisma.warehouse.create({ data: { companyId, name: "Navi Mumbai Yard", type: "WAREHOUSE", address: "Turbhe MIDC" } });
  const projects = await prisma.project.findMany({ where: { id: { in: proj.projectIds } }, orderBy: { code: "asc" } });
  const sites: Record<string, string> = {};
  for (const p of projects.slice(0, 2)) sites[p.id] = (await prisma.warehouse.create({ data: { companyId, name: `Site – ${p.code} ${p.name}`, type: "SITE", projectId: p.id, address: p.siteAddress } })).id;

  // materials + opening stock (ledger INWARD)
  const mats: { id: string; name: string; cost: number }[] = [];
  let sku = 0;
  for (const m of MATERIALS) {
    sku++;
    const mat = await prisma.material.create({ data: { companyId, sku: `MAT-${String(sku).padStart(5, "0")}`, name: m[0], category: m[1], unit: m[2], purchaseCost: m[3], minStock: m[4], reorderLevel: m[5], vendorId: vendors[m[6]].id } });
    mats.push({ id: mat.id, name: m[0], cost: m[3] });
    await prisma.stockBalance.create({ data: { companyId, materialId: mat.id, locationId: main.id, quantity: m[7], avgCost: m[3] } });
    await prisma.inventoryTransaction.create({ data: { companyId, type: "INWARD", materialId: mat.id, toLocationId: main.id, quantity: m[7], unitCost: m[3], refType: "MANUAL", note: "Opening stock", createdById: store.id, createdAt: day(-60) } });
  }
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "MAT" } }, update: { value: sku }, create: { companyId, key: "MAT", value: sku } });
  const mat = (name: string) => mats.find((m) => m.name.startsWith(name))!;

  const adjust = async (materialId: string, locationId: string, delta: number, unitCost: number) => {
    await prisma.stockBalance.upsert({ where: { materialId_locationId: { materialId, locationId } }, create: { companyId, materialId, locationId, quantity: delta, avgCost: unitCost }, update: { quantity: { increment: delta } } });
  };

  // purchase orders
  let poNo = 0;
  const mkPo = async (vendorIdx: number, projectIdx: number | null, status: PoStatus, deliveryOffset: number, lines: [string, number, number?][], approvalRole?: "MANAGEMENT" | "OWNER") => {
    poNo++;
    const items = lines.map(([n, q, r]) => { const m = mat(n); return { materialId: m.id, description: m.name, unit: MATERIALS.find((x) => x[0] === m.name)![2], quantity: q, rate: r ?? m.cost, taxPercent: 18 }; });
    const t = computeTotals(items.map((i) => ({ quantity: i.quantity, rate: i.rate, taxPercent: 18 })));
    const po = await prisma.purchaseOrder.create({
      data: {
        companyId, number: `PO-${String(poNo).padStart(5, "0")}`, vendorId: vendors[vendorIdx].id, projectId: projectIdx === null ? null : projects[projectIdx].id, status, orderDate: day(deliveryOffset - 10),
        deliveryDate: day(deliveryOffset), paymentTerms: "30 days from delivery", subtotal: t.subtotal, taxAmount: t.tax, total: t.total, createdById: proc.id,
        items: { create: items.map((i, idx) => ({ ...i, amount: t.lines[idx].amount })) },
      },
      include: { items: true },
    });
    if (status === "PENDING_APPROVAL") {
      await prisma.approval.create({ data: { companyId, type: "PURCHASE_ORDER", entityType: "PurchaseOrder", entityId: po.id, title: `${po.number} – ${vendors[vendorIdx].name}`, amount: po.total, requestedById: proc.id, requiredRole: approvalRole ?? "MANAGEMENT", steps: { create: { stepNo: 1, role: approvalRole ?? "MANAGEMENT" } } } });
    }
    return po;
  };

  const receive = async (po: Awaited<ReturnType<typeof mkPo>>, locationId: string, offset: number, fractions: number[]) => {
    const rn = await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "GRN" } }, update: { value: { increment: 1 } }, create: { companyId, key: "GRN", value: 1 } });
    const receipt = await prisma.materialReceipt.create({ data: { companyId, number: `GRN-${String(rn.value).padStart(5, "0")}`, poId: po.id, locationId, deliveryDate: day(offset), challanNo: `CH-${1000 + rn.value}`, vehicleNo: "MH04 AB 1234", receivedById: store.id } });
    for (let i = 0; i < po.items.length; i++) {
      const it = po.items[i];
      const qty = Math.round(Number(it.quantity) * fractions[i]);
      const damaged = i === 0 && fractions[i] < 1 ? 2 : 0;
      const accepted = qty - damaged;
      await prisma.materialReceiptItem.create({ data: { receiptId: receipt.id, poItemId: it.id, materialId: it.materialId, orderedQty: it.quantity, receivedQty: qty, damagedQty: damaged, rejectedQty: 0, acceptedQty: accepted } });
      await prisma.purchaseOrderItem.update({ where: { id: it.id }, data: { receivedQty: accepted } });
      if (it.materialId && accepted > 0) {
        await adjust(it.materialId, locationId, accepted, Number(it.rate));
        await prisma.inventoryTransaction.create({ data: { companyId, type: "INWARD", materialId: it.materialId, toLocationId: locationId, quantity: accepted, unitCost: it.rate, projectId: po.projectId, refType: "MATERIAL_RECEIPT", refId: receipt.id, note: `${receipt.number} against ${po.number}`, createdById: store.id, createdAt: day(offset) } });
      }
    }
  };

  const po1 = await mkPo(0, 0, "RECEIVED", -25, [["Plywood 18mm", 40], ["Laminate 1mm", 50], ["Edge band", 1500]]);
  await receive(po1, main.id, -24, [1, 1, 1]);
  const po2 = await mkPo(1, 0, "PARTIALLY_RECEIVED", -8, [["Soft-close hinge", 200], ["Telescopic channel", 120], ["Profile handle", 60]]);
  await receive(po2, main.id, -9, [0.6, 1, 0.5]);
  await mkPo(2, 1, "SENT_TO_VENDOR", -3, [["Wire 2.5", 12], ["Modular switch plate", 60], ["LED panel", 30]]); // overdue
  await mkPo(3, 1, "PENDING_APPROVAL", 12, [["Vitrified tile", 220], ["Tile adhesive", 90]], "OWNER");
  await mkPo(4, 0, "DRAFT", 10, [["Emulsion paint", 12], ["Wall putty", 30]]);
  await mkPo(0, 1, "APPROVED", 6, [["Gypsum board", 150], ["GI channel", 250]]);
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "PO" } }, update: { value: poNo }, create: { companyId, key: "PO", value: poNo } });

  // issue materials to PRJ-00001 site and consume some
  const p1 = projects[0];
  let minNo = 0;
  const issue = async (lines: [string, number][]) => {
    minNo++;
    const iss = await prisma.materialIssue.create({ data: { companyId, number: `MIN-${String(minNo).padStart(5, "0")}`, projectId: p1.id, fromLocationId: main.id, toLocationId: sites[p1.id], issuedById: store.id, receivedBy: "Mahesh Gaikwad", purpose: "Carcass & kitchen work", date: day(-12 + minNo) } });
    for (const [n, q] of lines) {
      const m = mat(n);
      const bal = await prisma.stockBalance.findUniqueOrThrow({ where: { materialId_locationId: { materialId: m.id, locationId: main.id } } });
      await prisma.materialIssueItem.create({ data: { issueId: iss.id, materialId: m.id, quantity: q, unitCost: bal.avgCost } });
      await adjust(m.id, main.id, -q, Number(bal.avgCost));
      await adjust(m.id, sites[p1.id], q, Number(bal.avgCost));
      await prisma.inventoryTransaction.create({ data: { companyId, type: "OUTWARD", materialId: m.id, fromLocationId: main.id, toLocationId: sites[p1.id], quantity: q, unitCost: bal.avgCost, projectId: p1.id, refType: "MATERIAL_ISSUE", refId: iss.id, note: `${iss.number} to ${p1.code}`, createdById: store.id, createdAt: day(-12 + minNo) } });
    }
  };
  await issue([["Plywood 18mm", 28], ["Laminate 1mm", 34], ["Edge band", 1100], ["Gypsum board", 90], ["GI channel", 140]]);
  await issue([["Soft-close hinge", 120], ["Telescopic channel", 70], ["Fevicol", 4], ["Wire 2.5", 8], ["Modular switch plate", 44], ["MCB 16A", 20]]);
  // site consumption
  for (const [n, q] of [["Plywood 18mm", 22], ["Laminate 1mm", 26], ["Gypsum board", 85], ["GI channel", 130], ["Wire 2.5", 6]] as [string, number][]) {
    const m = mat(n);
    await adjust(m.id, sites[p1.id], -q, m.cost);
    await prisma.inventoryTransaction.create({ data: { companyId, type: "CONSUMED", materialId: m.id, fromLocationId: sites[p1.id], quantity: q, unitCost: m.cost, projectId: p1.id, refType: "MANUAL", note: "Used on site", createdById: engineer.id, createdAt: day(-5) } });
  }
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "MIN" } }, update: { value: minNo }, create: { companyId, key: "MIN" , value: minNo } });

  // fevicol is below reorder level (14 − 4 = 10 < 24) → low-stock alert for procurement/store
  await prisma.notification.createMany({ data: [proc, store].map((u) => ({ companyId, userId: u.id, type: "LOW_STOCK" as const, title: "Low stock: Fevicol SH 5kg", body: "10 nos left (reorder level 24). Raise a purchase request.", link: "/inventory/stock?low=1" })) });

  // purchase requests: one approved waiting for a PO, one pending
  let prNo = 0;
  for (const [status, name, qty, who] of [["APPROVED", "Fevicol SH 5kg", 30, engineer.id], ["PENDING_APPROVAL", "Primer 20L", 10, pmUser.id]] as const) {
    prNo++;
    const m = mat(name);
    const pr = await prisma.purchaseRequest.create({ data: { companyId, number: `PR-${String(prNo).padStart(5, "0")}`, projectId: p1.id, requestedById: who, requiredDate: day(5), reason: status === "APPROVED" ? "Below reorder level" : "Painting phase starts next week", priority: "HIGH", status, items: { create: { materialId: m.id, description: m.name, unit: MATERIALS.find((x) => x[0] === m.name)![2], quantity: qty } } } });
    if (status === "PENDING_APPROVAL") await prisma.approval.create({ data: { companyId, type: "PURCHASE_REQUEST", entityType: "PurchaseRequest", entityId: pr.id, title: `Purchase request ${pr.number}`, amount: qty * m.cost, requestedById: who, requiredRole: "PROJECT_MANAGER", steps: { create: { stepNo: 1, role: "PROJECT_MANAGER" } } } });
  }
  await prisma.sequence.upsert({ where: { companyId_key: { companyId, key: "PR" } }, update: { value: prNo }, create: { companyId, key: "PR", value: prNo } });

  // link material schedule lines into the PRJ-00001 BOQ (quantities only) so planned-vs-actual has a baseline
  const boq = await prisma.boq.findFirst({ where: { projectId: p1.id } });
  if (boq) {
    const n = await prisma.boqItem.count({ where: { boqId: boq.id } });
    const sched: [string, number][] = [["Plywood 18mm", 60], ["Laminate 1mm", 70], ["Gypsum board", 100], ["GI channel", 150], ["Soft-close hinge", 220]];
    for (let i = 0; i < sched.length; i++) {
      const m = mat(sched[i][0]);
      await prisma.boqItem.create({ data: { boqId: boq.id, sortOrder: n + i, category: MATERIALS.find((x) => x[0] === m.name)![1], item: `${m.name} – material schedule`, unit: MATERIALS.find((x) => x[0] === m.name)![2], quantity: sched[i][1], materialId: m.id } });
    }
  }
}
