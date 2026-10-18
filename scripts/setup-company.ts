/**
 * First-run setup for a real installation (no demo data):
 *   npm run setup:company -- --company "DSC Interior Pvt. Ltd." --gstin 27AAECD2813K1ZP \
 *        --owner-name "Full Name" --owner-email owner@yourdomain.com --password "a-long-password"
 * Run it once against the live database (set DATABASE_URL first). It refuses to touch a company that already has users.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { setupCompany } from "./lib/setup";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const r = await setupCompany(prisma, {
      companyName: arg("company") ?? "", gstin: arg("gstin"), pan: arg("pan"), address: arg("address"), phone: arg("phone"), email: arg("email"),
      ownerName: arg("owner-name") ?? "", ownerEmail: arg("owner-email") ?? "", password: arg("password") ?? process.env.OWNER_PASSWORD ?? "",
    });
    console.log(`\nDone. Company ${r.companyId} created. Sign in as ${arg("owner-email")} and add your team under Settings → Team & Users.`);
  } catch (e) {
    console.error("\nSetup did not run:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
main();
