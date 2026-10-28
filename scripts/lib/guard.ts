import type { PrismaClient } from "@prisma/client";

/**
 * Stops the data tools from touching the wrong database. A Neon account can hold several databases (other projects),
 * and a pasted address is easy to mix up. Before anything is saved, cleared or loaded this checks that:
 *   1. an ONLINE address belongs to the DSC database (its host starts with the prefix below), and
 *   2. the database really is the DSC ERP: it has the Company and User tables, and one company.
 * Add --other-database to skip check 1 (for example after moving to a new Neon project).
 */
export const DSC_ONLINE_HOST_PREFIX = "ep-dry-art-az17hrxz";

export async function assertDscDatabase(prisma: PrismaClient, host: string, hosted: boolean): Promise<void> {
  if (hosted && !process.argv.includes("--other-database") && !host.startsWith(DSC_ONLINE_HOST_PREFIX)) {
    throw new Error(`That is not the DSC online database (its address should start with ${DSC_ONLINE_HOST_PREFIX}, this one starts with ${host.slice(0, 20)}). It is probably another project's database. Nothing was read or changed. Open the DSC project in Neon (or the Vercel project dsc_crm_softw, Settings, Environment Variables) and copy that one.`);
  }
  const t = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Company', 'User', 'Project')`;
  const have = new Set(t.map((r) => r.table_name));
  if (!have.has("Company") || !have.has("User")) throw new Error("This database is not the DSC ERP (it has no Company or User table). Nothing was changed.");
  const rows = await prisma.$queryRaw<{ name: string; users: number }[]>`SELECT c.name, (SELECT count(*) FROM "User")::int AS users FROM "Company" c ORDER BY c."createdAt" LIMIT 1`;
  if (!rows.length) throw new Error("This database has no company in it. Nothing was changed.");
  console.log(`Checked: this is the DSC ERP database (company "${rows[0].name}", ${rows[0].users} logins).`);
}
