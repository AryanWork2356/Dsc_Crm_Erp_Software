/**
 * Local development PostgreSQL (real Postgres binaries via the `embedded-postgres` package).
 * No system install needed. Production should use a managed/standard PostgreSQL via DATABASE_URL.
 *
 *   npm run db:start     -> starts Postgres on port 5433 and keeps running (Ctrl+C to stop)
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), ".pgdata-dev");
const port = Number(process.env.PG_PORT ?? 5434);
const dbName = "dsc_erp";

async function main() {
  const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  if (fresh) await pg.initialise();
  await pg.start();

  if (fresh) {
    await pg.createDatabase(dbName);
    console.log(`Created database ${dbName}`);
  }
  console.log(`PostgreSQL ready: postgresql://postgres:postgres@localhost:${port}/${dbName}`);

  const stop = async () => {
    console.log("Stopping PostgreSQL...");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
