/**
 * Loads the DEMO company into a hosted database (e.g. Neon) so it can be shown to people.
 *   npm run db:seed-hosted
 * It asks you to paste the database address, tidies it (quotes, < >, the unsupported channel_binding part),
 * shows only the host name back to you, and stores the demo files in the database (STORAGE_DRIVER=db).
 * The address is never saved or printed. Do NOT use this on the database that holds real company data.
 */
import readline from "node:readline/promises";

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const raw = await rl.question("Paste the database connection string, then press Enter: ");
  rl.close();
  const cleaned = raw.trim().replace(/^[\s'"<]+|[\s'">]+$/g, "");
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    throw new Error("That doesn't look like a database address. It should start with postgresql:// and be one long line.");
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("The address must start with postgresql://");
  if (["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("That is your own computer's database, not the online one. Copy the address from the Neon website.");
  if (!url.password) throw new Error("The address has no password in it. In Neon use Connect → show password, then copy the full string.");
  url.searchParams.delete("channel_binding");
  if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");

  process.env.DATABASE_URL = url.toString();
  process.env.STORAGE_DRIVER = "db";
  console.log(`\nConnecting to ${url.hostname} (database ${url.pathname.slice(1)}) …\n`);
  await import("../prisma/seed"); // runs the demo seed against that database
}

main().catch((e) => {
  console.error("\nCould not start:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
