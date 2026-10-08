/**
 * Demo data seed. Idempotent for the company/users; business demo data is only created on an empty DB.
 *   npm run db:seed
 * All demo users share the password in DEMO_PASSWORD.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedCore } from "./seed/core";
import { seedCrm } from "./seed/crm";
import { seedSales } from "./seed/sales";
import { seedProjects } from "./seed/projects";
import { seedProcurement } from "./seed/procurement";
import { seedWorkforce } from "./seed/workforce";
import { seedFinance } from "./seed/finance";
import { seedExtras, seedPortal } from "./seed/extras";

export const prisma = new PrismaClient();
export const DEMO_PASSWORD = "Demo@1234";

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const core = await seedCore(prisma, passwordHash);
  const crm = await seedCrm(prisma, core);
  await seedSales(prisma, core, crm);
  const proj = await seedProjects(prisma, core, crm);
  await seedProcurement(prisma, core, proj);
  await seedWorkforce(prisma, core, proj, passwordHash);
  await seedFinance(prisma, core, proj);
  await seedExtras(prisma, core, crm, proj);
  await seedPortal(prisma, core, crm, proj, passwordHash);
  console.log("\nSeed complete. Demo logins (password: " + DEMO_PASSWORD + "):");
  for (const u of core.users) console.log(`  ${u.role.padEnd(16)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
