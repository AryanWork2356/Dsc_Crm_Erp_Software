import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedCore } from "../prisma/seed/core";
import { seedCrm } from "../prisma/seed/crm";
import { seedSales } from "../prisma/seed/sales";
import { seedProjects } from "../prisma/seed/projects";
import { seedProcurement } from "../prisma/seed/procurement";
import { seedWorkforce } from "../prisma/seed/workforce";
import { seedFinance } from "../prisma/seed/finance";

const ADMIN = "postgresql://postgres:postgres@localhost:5434/postgres";
const URL = "postgresql://postgres:postgres@localhost:5434/dsc_erp_perf";

/** Builds a throw-away database with realistic *volume*: 10k leads, 10k tasks, 100k stock movements, 100k attendance rows. */
export default async function setup() {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS dsc_erp_perf WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE dsc_erp_perf`);
  await admin.$disconnect();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });

  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const hash = await bcrypt.hash("Demo@1234", 4);
  const core = await seedCore(prisma, hash);
  const crm = await seedCrm(prisma, core);
  await seedSales(prisma, core, crm);
  const proj = await seedProjects(prisma, core, crm);
  await seedProcurement(prisma, core, proj);
  await seedWorkforce(prisma, core, proj, hash);
  await seedFinance(prisma, core, proj);

  const t0 = Date.now();
  const co = core.companyId;
  // 10,000 leads
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Lead" (id, "companyId", code, name, phone, source, segment, location, "estimatedValue", stage, priority, "assignedToId", "createdAt", "updatedAt")
    SELECT 'perf_lead_' || g, '${co}', 'PLD-' || lpad(g::text, 6, '0'), 'Perf Lead ' || g || ' ' || (ARRAY['Sharma','Patil','Mehta','Iyer','Khan','Desai'])[1 + g % 6],
           '9' || lpad((800000000 + g)::text, 9, '0'), (ARRAY['Instagram','Referral','Website','Google Ads'])[1 + g % 4],
           (ARRAY['RESIDENTIAL','COMMERCIAL','RETAIL','CORPORATE','HOTEL'])[1 + g % 5]::"SegmentType", 'Thane',
           500000 + (g % 50) * 100000, (ARRAY['NEW','CONTACTED','QUALIFIED','NEGOTIATION','WON','LOST'])[1 + g % 6]::"LeadStage", 'MEDIUM',
           (SELECT id FROM "User" WHERE role = 'SALES' ORDER BY id LIMIT 1), now() - (g || ' minutes')::interval, now()
    FROM generate_series(1, 10000) g`);
  // 10,000 tasks
  await prisma.$executeRawUnsafe(`
    INSERT INTO "ProjectTask" (id, "companyId", code, "projectId", name, status, progress, priority, "dueDate", "createdAt", "updatedAt")
    SELECT 'perf_task_' || g, '${co}', 'PTK-' || lpad(g::text, 6, '0'), (SELECT id FROM "Project" ORDER BY code LIMIT 1 OFFSET (g % 5)), 'Perf task ' || g,
           (ARRAY['TODO','IN_PROGRESS','COMPLETED'])[1 + g % 3]::"TaskStatus", (g % 4) * 25, 'MEDIUM', now() + ((g % 60) - 20 || ' days')::interval, now(), now()
    FROM generate_series(1, 10000) g`);
  // 100,000 inventory transactions
  await prisma.$executeRawUnsafe(`
    INSERT INTO "InventoryTransaction" (id, "companyId", type, "materialId", "toLocationId", quantity, "unitCost", "refType", "createdAt")
    SELECT 'perf_txn_' || g, '${co}', 'INWARD', (SELECT id FROM "Material" ORDER BY sku LIMIT 1 OFFSET (g % 20)), (SELECT id FROM "Warehouse" WHERE type='WAREHOUSE' ORDER BY name LIMIT 1),
           1 + g % 10, 100 + g % 500, 'MANUAL', now() - (g || ' minutes')::interval
    FROM generate_series(1, 100000) g`);
  // 500 more workers x 200 days = 100,000 attendance rows
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Worker" (id, "companyId", code, name, trade, "wageType", "dailyWage", "monthlyWage", "currentProjectId", "isActive", "createdAt", "updatedAt")
    SELECT 'perf_w_' || g, '${co}', 'PW-' || lpad(g::text, 5, '0'), 'Perf Worker ' || g, 'HELPER', 'DAILY', 700, 0, (SELECT id FROM "Project" ORDER BY code LIMIT 1), true, now(), now()
    FROM generate_series(1, 500) g`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Attendance" (id, "companyId", date, "workerId", "projectId", status, method, "wageCost", "overtimeHrs", "createdAt")
    SELECT 'perf_att_' || w || '_' || d, '${co}', (current_date - d), 'perf_w_' || w, (SELECT id FROM "Project" ORDER BY code LIMIT 1), 'PRESENT', 'MANUAL', 700, 0, now()
    FROM generate_series(1, 500) w, generate_series(1, 200) d`);
  await prisma.$executeRawUnsafe(`ANALYZE`);
  console.log(`perf data loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await prisma.$disconnect();
}
