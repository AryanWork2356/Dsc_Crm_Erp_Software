/**
 * Moving the DSC data from one database to another (old Neon → new Neon). Never asks for an address on screen: it reads files.
 *
 *   npx tsx scripts/move-data.ts backup                        reads .env.old (the live database) and saves a full copy; changes NOTHING
 *   npx tsx scripts/move-data.ts restore "<saved folder>"      puts a saved copy into the database named in .env.new (must be EMPTY)
 *   npx tsx scripts/move-data.ts verify "<saved folder>"       compares the saved copy with .env.new row by row (counts)
 *
 * The saved copy is plain JSON, one file per table (uploaded files are rows of the StoredFile table, so they are included).
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { OLD_ONLINE_HOST_PREFIX as DSC_ONLINE_HOST_PREFIX } from "./lib/guard";

const APP = path.resolve(process.cwd());
const BACKUPS = path.resolve(APP, "..", "backups");
const q = (t: string) => `"${t.replace(/"/g, '""')}"`;

function envFile(name: string): Record<string, string> {
  const f = path.join(APP, name);
  if (!fs.existsSync(f)) throw new Error(`${name} was not found in ${APP}.`);
  return Object.fromEntries(fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
}
const open = (url: string) => new PrismaClient({ datasourceUrl: url.replace(/[&?]channel_binding=require/, "") });
const host = (url: string) => new URL(url).hostname;

async function tables(db: PrismaClient): Promise<string[]> {
  const r = await db.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
  return r.map((x) => x.table_name);
}
async function count(db: PrismaClient, t: string): Promise<number> {
  return Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM ${q(t)}`))[0].n);
}

async function backup() {
  const url = envFile(".env.old").DATABASE_URL;
  if (!host(url).startsWith(DSC_ONLINE_HOST_PREFIX)) throw new Error(`.env.old does not point at the live DSC database (host ${host(url)}). Nothing was read.`);
  const db = open(url);
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = path.join(BACKUPS, `live-before-move-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    const counts: Record<string, number> = {};
    // one consistent picture of the database: everything is read inside one read-only transaction
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      for (const t of await tables(tx as unknown as PrismaClient)) {
        const r = await tx.$queryRawUnsafe<{ j: unknown }[]>(`SELECT COALESCE(json_agg(x), '[]'::json) AS j FROM ${q(t)} x`);
        const list = r[0].j as unknown[];
        counts[t] = list.length;
        fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(list));
      }
    }, { timeout: 300000, maxWait: 30000 });
    fs.writeFileSync(path.join(dir, "_counts.json"), JSON.stringify(counts, null, 2));
    // read every file back and check the number of rows
    for (const [t, n] of Object.entries(counts)) {
      const back = JSON.parse(fs.readFileSync(path.join(dir, `${t}.json`), "utf8")) as unknown[];
      if (back.length !== n) throw new Error(`Backup check failed for ${t}.`);
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const bytes = fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
    console.log(`BACKUP OK: ${total} rows from ${Object.keys(counts).length} tables, ${(bytes / 1048576).toFixed(1)} MB, saved in ${dir}`);
    console.log("Busiest tables: " + Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t} ${n}`).join(", "));
    console.log("The live database was only read; nothing was changed.");
  } finally { await db.$disconnect(); }
}

async function restore(folder: string) {
  if (!folder || !fs.existsSync(path.join(folder, "_counts.json"))) throw new Error("Give the saved folder.");
  const url = envFile(".env.new").DATABASE_URL;
  if (host(url).startsWith(DSC_ONLINE_HOST_PREFIX)) throw new Error("Refusing: .env.new points at the OLD live database. Nothing was changed.");
  const db = open(url);
  try {
    const existing = await tables(db);
    const filled: string[] = [];
    for (const t of existing) if (await count(db, t) > 0) filled.push(t);
    if (filled.length) throw new Error(`The new database is not empty (${filled.slice(0, 5).join(", ")}). Nothing was changed.`);
    const counts = JSON.parse(fs.readFileSync(path.join(folder, "_counts.json"), "utf8")) as Record<string, number>;
    let pending = Object.keys(counts).filter((t) => counts[t] > 0 && existing.includes(t));
    await db.$transaction(async (tx) => {
      let round = 0;
      while (pending.length && round++ < 80) {
        const failed: string[] = [];
        for (const t of pending) {
          const json = fs.readFileSync(path.join(folder, `${t}.json`), "utf8");
          await tx.$executeRawUnsafe("SAVEPOINT s");
          try {
            await tx.$executeRawUnsafe(`INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(null::${q(t)}, $1::json)`, json);
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT s");
          } catch { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s"); failed.push(t); } // needs another table first: next round
        }
        if (failed.length === pending.length) throw new Error(`Could not copy: ${failed.join(", ")}`);
        pending = failed;
      }
    }, { timeout: 600000, maxWait: 30000 });
    console.log("RESTORE OK: the saved copy is now in the new database.");
  } finally { await db.$disconnect(); }
  await verify(folder);
}

async function verify(folder: string) {
  const db = open(envFile(".env.new").DATABASE_URL);
  try {
    const counts = JSON.parse(fs.readFileSync(path.join(folder, "_counts.json"), "utf8")) as Record<string, number>;
    const bad: string[] = [];
    let total = 0;
    for (const t of await tables(db)) { const n = await count(db, t); total += n; if ((counts[t] ?? 0) !== n) bad.push(`${t}: saved ${counts[t] ?? 0}, new database ${n}`); }
    console.log(bad.length ? `VERIFY FAILED: ${bad.join("; ")}` : `VERIFY OK: all ${Object.keys(counts).length} tables match row for row (${total} rows)`);
    if (bad.length) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}

const [cmd, arg] = process.argv.slice(2);
(cmd === "backup" ? backup() : cmd === "restore" ? restore(arg) : cmd === "verify" ? verify(arg) : Promise.reject(new Error("Use: backup | restore <folder> | verify <folder>"))).catch((e) => { console.error("STOPPED:", e instanceof Error ? e.message : e); process.exitCode = 1; });
