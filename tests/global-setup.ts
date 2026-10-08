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
import { seedExtras, seedPortal } from "../prisma/seed/extras";

const ADMIN_URL = "postgresql://postgres:postgres@localhost:5434/postgres";
const TEST_URL = "postgresql://postgres:postgres@localhost:5434/dsc_erp_test";

/** Recreates a clean test database, applies migrations and seeds the demo data. Requires `npm run db:start`. */
export default async function setup() {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS dsc_erp_test WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE dsc_erp_test`);
  await admin.$disconnect();

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: "pipe" });

  const prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  const hash = await bcrypt.hash("Demo@1234", 4);
  const core = await seedCore(prisma, hash);
  const crm = await seedCrm(prisma, core);
  await seedSales(prisma, core, crm);
  const proj = await seedProjects(prisma, core, crm);
  await seedProcurement(prisma, core, proj);
  await seedWorkforce(prisma, core, proj, hash);
  await seedFinance(prisma, core, proj);
  await seedExtras(prisma, core, crm, proj);
  await seedPortal(prisma, core, crm, proj, hash);
  await prisma.$disconnect();
}
