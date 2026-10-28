/**
 * Save and clear the company data, or bring a saved copy back.
 *
 *   npm run data:backup                 this computer's database: saves a full copy and changes nothing
 *   npm run data:backup-hosted          the same for the ONLINE database (asks you to paste its address)
 *   npm run data:clear                  this computer's database: saves a full copy, then clears the demo data
 *   npm run data:clear-hosted           the same for the ONLINE database (asks you to paste its address)
 *   npm run data:restore -- <folder>    puts a saved copy back (this computer)
 *   npm run data:restore-hosted -- <folder>
 *
 * Clearing keeps: the company and its settings, the permission tables, the Terms & Conditions templates and the
 * staff logins (so you can still sign in). Everything else (clients, leads, projects, BOQs, quotations, stock,
 * HR, finance, documents, numbering …) is removed. Client / vendor / worker portal logins go with their records.
 * The saved copy is plain JSON files in <project>/backups/<date-time>/ (one file per table, plus uploaded files).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { PrismaClient } from "@prisma/client";
import { assertDscDatabase } from "./lib/guard";

const KEEP = new Set(["Company", "CompanySettings", "Permission", "RolePermission", "TermsAndConditions", "User"]);
const BACKUPS = path.resolve(process.cwd(), "..", "backups");
const UPLOADS = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./uploads");

async function ask(q: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a.trim();
}

async function connect(hosted: boolean) {
  if (!hosted) {
    const u = process.env.DATABASE_URL ?? "";
    const host = u ? new URL(u).hostname : "";
    return { prisma: new PrismaClient(), where: `this computer (${host || "from .env"})`, host };
  }
  const raw = await ask("Paste the ONLINE database connection string, then press Enter: ");
  const url = new URL(raw.replace(/^[\s'"<]+|[\s'">]+$/g, ""));
  if (["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("That is your own computer's database, not the online one.");
  url.searchParams.delete("channel_binding");
  if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
  return { prisma: new PrismaClient({ datasources: { db: { url: url.toString() } } }), where: `${url.hostname} (database ${url.pathname.slice(1)})`, host: url.hostname };
}

async function tables(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  return rows.map((r) => r.table_name);
}
const q = (t: string) => `"${t.replace(/"/g, '""')}"`;

async function backup(prisma: PrismaClient): Promise<{ dir: string; counts: Record<string, number> }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(BACKUPS, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const counts: Record<string, number> = {};
  for (const t of await tables(prisma)) {
    const r = await prisma.$queryRawUnsafe<{ j: unknown }[]>(`SELECT COALESCE(json_agg(x), '[]'::json) AS j FROM ${q(t)} x`);
    const list = r[0].j as unknown[];
    counts[t] = list.length;
    fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(list));
  }
  if (fs.existsSync(UPLOADS)) fs.cpSync(UPLOADS, path.join(dir, "uploads"), { recursive: true });
  fs.writeFileSync(path.join(dir, "_counts.json"), JSON.stringify(counts, null, 2));
  // check what was written before anything is deleted
  for (const [t, n] of Object.entries(counts)) {
    const back = JSON.parse(fs.readFileSync(path.join(dir, `${t}.json`), "utf8")) as unknown[];
    if (back.length !== n) throw new Error(`Backup check failed for ${t}. Nothing was deleted.`);
  }
  return { dir, counts };
}

async function backupOnly(hosted: boolean) {
  const { prisma, where, host } = await connect(hosted);
  try {
    console.log(`
Database: ${where}`);
    await assertDscDatabase(prisma, host, hosted);
    const { dir, counts } = await backup(prisma);
    console.log(`Saved ${Object.values(counts).reduce((a, b) => a + b, 0)} rows from ${Object.keys(counts).length} tables to:
  ${dir}
Nothing was changed or removed.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function clear(hosted: boolean, yes: boolean) {
  const { prisma, where, host } = await connect(hosted);
  try {
    console.log(`\nDatabase: ${where}`);
    await assertDscDatabase(prisma, host, hosted);
    await assertDscDatabase(prisma, host, hosted);
    console.log("Saving a full copy first …");
    const { dir, counts } = await backup(prisma);
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`Saved ${rows} rows from ${Object.keys(counts).length} tables to:\n  ${dir}\n`);
    if (!yes && (await ask("Type CLEAR to remove the data from this database now: ")) !== "CLEAR") {
      console.log("Nothing was removed.");
      return;
    }
    const wipe = (await tables(prisma)).filter((t) => !KEEP.has(t));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`TRUNCATE ${wipe.map(q).join(", ")} RESTART IDENTITY CASCADE`);
      await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE role IN ('CLIENT', 'VENDOR', 'WORKER')`);
      await tx.$executeRawUnsafe(`UPDATE "User" SET "clientId" = NULL, "vendorId" = NULL, "workerId" = NULL`);
    }, { timeout: 120000 });
    if (fs.existsSync(UPLOADS)) for (const f of fs.readdirSync(UPLOADS)) fs.rmSync(path.join(UPLOADS, f), { recursive: true, force: true });
    const users = await prisma.user.count();
    console.log(`Done. Cleared ${wipe.length} tables. Kept the company, its settings and ${users} staff logins.`);
    console.log(`To bring the old data back:  npm run data:restore${hosted ? "-hosted" : ""} -- "${dir}"`);
  } finally {
    await prisma.$disconnect();
  }
}

async function restore(hosted: boolean, folder: string) {
  if (!folder || !fs.existsSync(path.join(folder, "_counts.json"))) throw new Error('Give the saved folder, for example: npm run data:restore -- "D:\\DSC_Crm_Softw\\backups\\2026-10-19T09-00-00"');
  const { prisma, where, host } = await connect(hosted);
  try {
    await assertDscDatabase(prisma, host, hosted);
    await assertDscDatabase(prisma, host, hosted);
    console.log(`\nPutting ${folder}\nback into ${where} …`);
    const counts = JSON.parse(fs.readFileSync(path.join(folder, "_counts.json"), "utf8")) as Record<string, number>;
    let pending = Object.keys(counts).filter((t) => counts[t] > 0);
    const existing = new Set(await tables(prisma));
    pending = pending.filter((t) => existing.has(t));
    await prisma.$transaction(async (tx) => {
      let round = 0;
      while (pending.length && round++ < 60) {
        const failed: string[] = [];
        for (const t of pending) {
          const json = fs.readFileSync(path.join(folder, `${t}.json`), "utf8");
          await tx.$executeRawUnsafe("SAVEPOINT s");
          try {
            await tx.$executeRawUnsafe(`INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(null::${q(t)}, $1::json) ON CONFLICT DO NOTHING`, json);
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT s");
          } catch {
            await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s");
            failed.push(t); // probably needs another table first; try again next round
          }
        }
        if (failed.length === pending.length) throw new Error(`Could not restore: ${failed.join(", ")}`);
        pending = failed;
      }
    }, { timeout: 300000, maxWait: 30000 });
    const up = path.join(folder, "uploads");
    if (fs.existsSync(up)) fs.cpSync(up, UPLOADS, { recursive: true });
    console.log("Done. The saved data is back.");
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const hosted = rest.includes("--hosted");
  const yes = rest.includes("--yes");
  const arg = rest.find((a) => !a.startsWith("--")) ?? "";
  if (cmd === "backup") await backupOnly(hosted);
  else if (cmd === "clear") await clear(hosted, yes);
  else if (cmd === "restore") await restore(hosted, arg);
  else throw new Error("Use: backup | clear | restore");
}

main().catch((e) => {
  console.error("\nStopped:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
