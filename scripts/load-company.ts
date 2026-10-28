/**
 * Puts DSC's real people, clients and vendors into a database that has been cleared of practice data.
 *
 *   npm run data:load                 this computer's database
 *   npm run data:load-hosted          the ONLINE database (asks you to paste its address, like data:clear-hosted)
 *   add  -- --dry-run                 shows what would be created and changes nothing
 *
 * Reads two files from  <DSC folder>/Dsc_app/real-data/ :
 *   employees.json                                  the staff list (name, job, app role)
 *   Supplier Contractor and Client Details.xlsx     suppliers, contractors and clients
 *
 * What it does
 *   - creates a login (short ID + password) and an employee record for every person who has an app role;
 *   - people with no matching app role get an employee record only (no login) and are listed for confirmation;
 *   - creates the clients, suppliers and contractors (contractors are vendors);
 *   - renames the old test logins (@dsc.demo) to "Test login: <role>" and gives each a NEW random password, so the
 *     well-known demo password stops working on the online system. The logins themselves are kept.
 *   - login IDs and passwords are short: ID = first name + first letter of surname (gopals); password = first 3 letters of the name, @, two digits (Gop@47). Nobody is asked to change it; the Admin can reset any.
 *   - add --reissue to give EVERY staff login a new password in that style (use it once, to replace the first random ones).
 *   - writes ONE confidential Excel file with every ID and password. Passwords are stored only as hashes in the database,
 *     so this file is the only place they exist. Keep the file somewhere private: it is the company's record of the passwords.
 * Safe to run twice: people, clients and vendors that already exist are skipped (and get no new password).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { PrismaClient, type RoleKey } from "@prisma/client";
import { assertDscDatabase } from "./lib/guard";
import { issuedPassword, loginIdFor } from "../src/lib/issued-password";

const DATA = path.resolve(process.cwd(), "..", "Dsc_app", "real-data");
const DOMAIN = "dscinterior.com";
const SIGN_IN = "https://dsccrmsoftw.vercel.app";

const ROLE_LABEL: Partial<Record<RoleKey, string>> = {
  OWNER: "Owner", MANAGEMENT: "Management", ADMIN: "Admin", SALES: "Sales", PROJECT_MANAGER: "Project Manager", DESIGNER: "Designer",
  PROCUREMENT: "Procurement", ACCOUNTS: "Accounts", HR: "HR", STORE: "Store", SITE_ENGINEER: "Site Engineer", SITE_SUPERVISOR: "Site Supervisor",
};

async function ask(q: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a.trim();
}

async function connect(hosted: boolean) {
  if (!hosted) return { prisma: new PrismaClient(), where: "this computer", host: "localhost" };
  const raw = await ask("Paste the ONLINE database connection string, then press Enter: ");
  const url = new URL(raw.replace(/^[\s'"<]+|[\s'">]+$/g, ""));
  if (["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("That is your own computer's database, not the online one.");
  url.searchParams.delete("channel_binding");
  if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
  return { prisma: new PrismaClient({ datasources: { db: { url: url.toString() } } }), where: `${url.hostname} (database ${url.pathname.slice(1)})`, host: url.hostname };
}

/**
 * People with special accounts. Found by their old login (if they had one) or by name, given their real name and role,
 * and created if they do not exist yet. Dinesh is the Owner; Gopal and Satish are directors; Aryan is the host (Owner-level).
 */
const SPECIAL: { name: string; designation: string; role: RoleKey; legacy: string }[] = [
  { name: "Dinesh Sharma", designation: "Owner", role: "OWNER", legacy: "dinesh@dsc.demo" },
  { name: "Gopal Sharma", designation: "Project Director", role: "MANAGEMENT", legacy: "gopal@dsc.demo" },
  { name: "Satish Sharma", designation: "Director", role: "MANAGEMENT", legacy: "director@dsc.demo" },
  { name: "Aryan Shetty", designation: "Host", role: "OWNER", legacy: "aryan1@dsc.in" },
];
const SPECIAL_NAMES = new Set(SPECIAL.map((x) => x.name));
const isTestName = (n: string) => n.startsWith("Test login:");

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const cellText = (v: ExcelJS.CellValue): string => (v && typeof v === "object" && "richText" in v ? v.richText.map((r) => r.text).join("") : v && typeof v === "object" && "text" in v ? String((v as { text: unknown }).text) : clean(v));

type Row = { name: string; phone: string | null; gstin: string | null; address: string | null };
async function readSheet(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const out: Record<"SUPPLIER" | "CONTRACTOR" | "CLIENT", Row[]> = { SUPPLIER: [], CONTRACTOR: [], CLIENT: [] };
  let section: keyof typeof out | null = null;
  ws.eachRow((row) => {
    const b = cellText(row.getCell(2).value).toUpperCase();
    if (b === "SUPPLIER" || b === "CONTRACTOR" || b === "CLIENT") { section = b; return; }
    if (!section) return;
    const sn = cellText(row.getCell(2).value);
    const name = cellText(row.getCell(3).value);
    if (!/^\d+$/.test(sn) || !name) return; // header and blank rows
    const phone = cellText(row.getCell(4).value).replace(/\D/g, "");
    const gstin = cellText(row.getCell(5).value).toUpperCase().replace(/\s/g, "");
    out[section].push({ name, phone: phone || null, gstin: gstin || null, address: cellText(row.getCell(6).value) || null });
  });
  return out;
}

/** What a vendor does, only when its own name says so. Anything else is left empty for DSC to fill in. */
function inferred(name: string, kind: "SUPPLIER" | "CONTRACTOR"): { categories: string; trades: string | null } {
  const n = name.toLowerCase();
  if (kind === "CONTRACTOR") return { categories: n.includes("electric") ? "Contractor – electrical" : "Contractor", trades: n.includes("electric") ? "Electrician" : null };
  const what = n.includes("laminate") ? "Laminates" : n.includes("aluminium") ? "Aluminium" : n.includes("hardware") ? "Hardware" : n.includes("timber") ? "Timber" : null;
  return { categories: what ? `Supplier – ${what}` : "Supplier", trades: null };
}

function splitContractor(raw: string): { name: string; person: string | null } {
  const i = raw.indexOf(" - ");
  if (i < 0) return { name: raw, person: null };
  return { name: raw.slice(0, i).trim(), person: raw.slice(i + 3).trim().replace(/([a-z])([A-Z])/g, "$1 $2") };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const hosted = process.argv.includes("--hosted");
  const people = JSON.parse(fs.readFileSync(path.join(DATA, "employees.json"), "utf8")) as { sr: number; name: string; designation: string | null; role: RoleKey | null; confirm?: string; skip?: boolean }[];
  const sheet = await readSheet(path.join(DATA, "Supplier Contractor and Client Details.xlsx"));
  const { prisma, where, host } = await connect(hosted);
  try {
    console.log(`\nDatabase: ${where}${dry ? "   (dry run: nothing will be changed)" : ""}`);
    await assertDscDatabase(prisma, host, hosted);
    const company = await prisma.company.findFirst();
    if (!company) throw new Error("There is no company in this database yet.");
    const cid = company.id;
    const existing = await prisma.user.findMany({ where: { companyId: cid }, select: { email: true, role: true, id: true, name: true, mustChangePassword: true, passwordChangedAt: true } });
    const taken = new Set(existing.map((u) => u.email.toLowerCase()));

    const issued = new Map<string, string>(); // user id → the password issued in this run
    const noLogin: { name: string; designation: string; why: string }[] = [];
    const confirm: { name: string; designation: string; note: string }[] = [];
    let newUsers = 0, newEmployees = 0, skipped = 0, removed = 0, changed = 0, idsChanged = 0;

    const nextEmp = async (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => {
      for (let i = 0; i < 500; i++) {
        const row = await tx.sequence.upsert({ where: { companyId_key: { companyId: cid, key: "EMP" } }, create: { companyId: cid, key: "EMP", value: 1 }, update: { value: { increment: 1 } } });
        const code = `EMP-${String(row.value).padStart(3, "0")}`;
        if (!(await tx.employee.findFirst({ where: { companyId: cid, code }, select: { id: true } }))) return code;
      }
      throw new Error("No free employee code");
    };

    // 1. staff: new people are created; people already there get their role and job brought up to date
    for (const p of people) {
      if (p.confirm) confirm.push({ name: p.name, designation: p.designation ?? "(none written)", note: p.confirm });
      // people DSC does not want in the app: any employee record without a login is removed (hidden), nothing else is touched
      if (p.skip) {
        const gone = await prisma.employee.findMany({ where: { companyId: cid, name: p.name, deletedAt: null, userId: null }, select: { id: true } });
        if (gone.length && !dry) await prisma.employee.updateMany({ where: { id: { in: gone.map((g) => g.id) } }, data: { deletedAt: new Date(), status: "EXITED" } });
        if (gone.length) { removed++; console.log(`  ${dry ? "would remove" : "removed"} ${p.name} (not set up, as asked)`); }
        continue;
      }
      if (SPECIAL_NAMES.has(p.name)) { skipped++; continue; } // set up with the Owner and directors below
      const have = await prisma.user.findFirst({ where: { companyId: cid, name: p.name, deletedAt: null, role: { notIn: ["WORKER", "CLIENT", "VENDOR"] } }, include: { employee: true } });
      if (have && p.role) {
        const roleChanged = have.role !== p.role;
        if (roleChanged || (have.employee && have.employee.designation !== p.designation)) {
          if (!dry) {
            if (roleChanged) await prisma.user.update({ where: { id: have.id }, data: { role: p.role } });
            if (have.employee) await prisma.employee.update({ where: { id: have.employee.id }, data: { designation: p.designation } });
          }
          changed++;
          console.log(`  ${dry ? "would change" : "changed"} ${p.name}: ${ROLE_LABEL[have.role] ?? have.role} → ${ROLE_LABEL[p.role] ?? p.role}${roleChanged ? "" : " (job title only)"}`);
        }
        skipped++;
        continue;
      }
      const already = (await prisma.employee.findFirst({ where: { companyId: cid, name: p.name, deletedAt: null }, select: { id: true } })) ?? (await prisma.user.findFirst({ where: { companyId: cid, name: p.name, deletedAt: null }, select: { id: true } }));
      if (already) { skipped++; continue; }
      if (!p.role) noLogin.push({ name: p.name, designation: p.designation ?? "(none written)", why: p.confirm ?? "" });
      if (dry) { console.log(`  would add ${p.name} (${p.designation ?? "-"}) ${p.role ? `as ${ROLE_LABEL[p.role]}` : "– employee record only"}`); continue; }
      await prisma.$transaction(async (tx) => {
        const email = p.role ? loginIdFor(p.name, taken) : null;
        const pw = p.role ? issuedPassword(p.name) : null;
        const user = p.role && email && pw ? await tx.user.create({ data: { companyId: cid, email, name: p.name, role: p.role, passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: false } }) : null;
        if (user && pw) issued.set(user.id, pw);
        const code = await nextEmp(tx);
        await tx.employee.create({ data: { companyId: cid, userId: user?.id ?? null, code, name: p.name, email, designation: p.designation, status: "ACTIVE" } });
        if (user) newUsers++;
        newEmployees++;
      });
    }

    // 2. the Owner, the directors and the host: real names, right roles, an employee record each (created if they do not exist yet)
    for (const sp of SPECIAL) {
      const u = (await prisma.user.findFirst({ where: { companyId: cid, deletedAt: null, OR: [{ email: sp.legacy }, { name: sp.name }] }, include: { employee: true } })) ?? null;
      if (dry) { console.log(`  would ${u ? "update" : "create"} ${sp.name} (${sp.designation}) as ${ROLE_LABEL[sp.role]}`); continue; }
      if (u) {
        await prisma.user.update({ where: { id: u.id }, data: { name: sp.name, role: sp.role, isActive: true } });
        if (u.employee) await prisma.employee.update({ where: { id: u.employee.id }, data: { name: sp.name, designation: sp.designation } });
        else await prisma.$transaction(async (tx) => { const code = await nextEmp(tx); await tx.employee.create({ data: { companyId: cid, userId: u.id, code, name: sp.name, email: u.email, designation: sp.designation, status: "ACTIVE" } }); });
      } else {
        await prisma.$transaction(async (tx) => {
          const email = loginIdFor(sp.name, taken);
          const pw = issuedPassword(sp.name);
          const user = await tx.user.create({ data: { companyId: cid, email, name: sp.name, role: sp.role, passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: false } });
          issued.set(user.id, pw);
          const code = await nextEmp(tx);
          await tx.employee.create({ data: { companyId: cid, userId: user.id, code, name: sp.name, email, designation: sp.designation, status: "ACTIVE" } });
          newUsers++; newEmployees++;
        });
      }
    }

    // 3. the old test logins (@dsc.demo): kept, named "Test login: <role>", and never offered in a list of people
    if (!dry) {
      for (const u of await prisma.user.findMany({ where: { companyId: cid, deletedAt: null, email: { endsWith: "@dsc.demo" } } })) {
        if (SPECIAL.some((sp) => sp.legacy === u.email) || SPECIAL_NAMES.has(u.name) || isTestName(u.name)) continue;
        if (["WORKER", "CLIENT", "VENDOR"].includes(u.role)) continue;
        await prisma.user.update({ where: { id: u.id }, data: { name: `Test login: ${ROLE_LABEL[u.role] ?? u.role}` } });
        issued.set(u.id, ""); // given a password in step 4
      }
    }

    // 4. short IDs for every real person (first name + first letter of surname), and a new password wherever the ID changes.
    //    --reissue gives every staff login a new password, even where the ID did not change.
    const reissue = process.argv.includes("--reissue");
    if (!dry) {
      const staff = await prisma.user.findMany({ where: { companyId: cid, deletedAt: null, isActive: true, role: { notIn: ["WORKER", "CLIENT", "VENDOR"] } }, orderBy: { createdAt: "asc" } });
      const real = staff.filter((u) => !isTestName(u.name));
      const fixed = new Set((await prisma.user.findMany({ where: { companyId: cid, NOT: { id: { in: real.map((u) => u.id) } } }, select: { email: true } })).map((u) => u.email.toLowerCase()));
      for (const u of real) {
        const id = loginIdFor(u.name, fixed);
        if (id !== u.email.toLowerCase()) {
          const pw = issuedPassword(u.name);
          await prisma.user.update({ where: { id: u.id }, data: { email: id, passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
          await prisma.employee.updateMany({ where: { userId: u.id }, data: { email: id } });
          issued.set(u.id, pw);
          idsChanged++;
        }
      }
      for (const u of staff) {
        if (reissue || issued.get(u.id) === "") {
          const pw = issuedPassword(u.name);
          await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: false, resetRequestedAt: null, failedLogins: 0, lockedUntil: null } });
          issued.set(u.id, pw);
        }
      }
      if (reissue) console.log(`Re-issued ${staff.length} passwords.`);
    }

    // 3. clients and vendors
    let clients = 0, vendors = 0;
    const nextCode = async (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], key: string, width = 5) => {
      const row = await tx.sequence.upsert({ where: { companyId_key: { companyId: cid, key } }, create: { companyId: cid, key, value: 1 }, update: { value: { increment: 1 } } });
      return `${key}-${String(row.value).padStart(width, "0")}`;
    };
    for (const c of sheet.CLIENT) {
      if (await prisma.client.findFirst({ where: { companyId: cid, name: c.name, deletedAt: null }, select: { id: true } })) continue;
      if (dry) { console.log(`  would add client ${c.name}`); continue; }
      await prisma.$transaction(async (tx) => {
        const code = await nextCode(tx, "CL");
        await tx.client.create({ data: { companyId: cid, code, name: c.name, companyName: c.name, phone: c.phone, gstin: c.gstin, address: c.address, billingAddress: c.address, notes: "Added from 'Supplier Contractor and Client Details.xlsx'. Contact person and e-mail to be added." } });
      });
      clients++;
    }
    for (const kind of ["SUPPLIER", "CONTRACTOR"] as const) {
      for (const v of sheet[kind]) {
        const { name, person } = kind === "CONTRACTOR" ? splitContractor(v.name) : { name: v.name, person: null };
        if (await prisma.vendor.findFirst({ where: { companyId: cid, name, deletedAt: null }, select: { id: true } })) continue;
        const inf = inferred(v.name, kind);
        if (dry) { console.log(`  would add ${kind.toLowerCase()} ${name}${person ? ` (${person})` : ""} → ${inf.categories}`); continue; }
        await prisma.$transaction(async (tx) => {
          const code = await nextCode(tx, "V");
          await tx.vendor.create({ data: { companyId: cid, code, name, contactPerson: person, phone: v.phone, whatsapp: v.phone, gstin: v.gstin, address: v.address, categories: inf.categories, trades: inf.trades, notes: `Added from 'Supplier Contractor and Client Details.xlsx' as a ${kind.toLowerCase()}. ${inf.trades || inf.categories.includes("–") ? "" : "What they supply / their trade is not known yet: please fill it in."}`.trim() } });
        });
        vendors++;
      }
    }

    if (changed || removed) console.log(`\nRoles or jobs changed: ${changed}. Removed (not wanted in the app): ${removed}.`);
    console.log(`\n${dry ? "Would create" : "Created"}: ${dry ? "" : `${newUsers} logins, ${newEmployees} employee records, ${clients} clients, ${vendors} vendors/suppliers.`}`);
    if (skipped) console.log(`Skipped ${skipped} people who already exist.`);
    if (idsChanged) console.log(`Login IDs shortened (with a new password each): ${idsChanged}`);
    if (noLogin.length) console.log(`Employee record only (no login): ${noLogin.map((n) => n.name).join(", ")}`);

    // the file: everybody who got a password in this run, read back from the database so the IDs are the final ones
    const given = [...issued.entries()].filter(([, pw]) => pw);
    if (!dry && given.length) {
      const users = await prisma.user.findMany({ where: { id: { in: given.map(([id]) => id) } } });
      const info = new Map(users.map((u) => [u.id, u]));
      const rows = given.map(([id, pw]) => ({ u: info.get(id)!, pw })).filter((r) => r.u);
      const short = (e: string) => (e.endsWith(`@${DOMAIN}`) ? e.slice(0, -(DOMAIN.length + 1)) : e);
      const special = rows.filter((r) => SPECIAL_NAMES.has(r.u.name));
      const tests = rows.filter((r) => isTestName(r.u.name));
      const real = rows.filter((r) => !SPECIAL_NAMES.has(r.u.name) && !isTestName(r.u.name));
      const sr = (name: string) => people.find((x) => x.name === name)?.sr ?? 99;
      const desig = (name: string) => SPECIAL.find((x) => x.name === name)?.designation ?? people.find((x) => x.name === name)?.designation ?? "";
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Employee logins");
      ws.addRow(["CONFIDENTIAL: DSC app logins. Give each person only their own line."]).font = { bold: true, color: { argb: "FFB91C1C" } };
      ws.addRow([`Sign in at ${SIGN_IN}   ·   Type only the Login ID (the app adds @${DOMAIN} by itself)   ·   The app keeps only scrambled copies, so keep this file safe: it is how you tell someone their password.`]);
      ws.addRow([]);
      const head = ws.addRow(["Sr", "Name", "Job", "Role in the app", "Login ID", "Password"]);
      head.font = { bold: true, color: { argb: "FFFFFFFF" } };
      head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A52" } }; });
      for (const r of special) ws.addRow(["", r.u.name, desig(r.u.name), ROLE_LABEL[r.u.role] ?? r.u.role, short(r.u.email), r.pw]);
      for (const r of real.sort((a, b) => sr(a.u.name) - sr(b.u.name))) ws.addRow([sr(r.u.name) === 99 ? "" : sr(r.u.name), r.u.name, desig(r.u.name), ROLE_LABEL[r.u.role] ?? r.u.role, short(r.u.email), r.pw]);
      ws.columns = [{ width: 5 }, { width: 26 }, { width: 28 }, { width: 18 }, { width: 22 }, { width: 14 }];
      if (noLogin.length) {
        ws.addRow([]);
        ws.addRow(["No login yet (employee record only):"]).font = { bold: true };
        for (const n of noLogin) ws.addRow(["", n.name, n.designation, "", n.why]);
      }
      if (tests.length) {
        const t2 = wb.addWorksheet("Test logins (private)");
        t2.addRow(["PRIVATE: for the Owner and host only. These are for trying the app; they never appear in lists of people."]).font = { bold: true, color: { argb: "FFB91C1C" } };
        t2.addRow([]);
        t2.addRow(["Name", "Role", "Login ID (type it in full)", "Password"]).font = { bold: true };
        for (const r of tests) t2.addRow([r.u.name, ROLE_LABEL[r.u.role] ?? r.u.role, r.u.email, r.pw]);
        t2.columns = [{ width: 30 }, { width: 18 }, { width: 28 }, { width: 14 }];
      }
      if (confirm.length) {
        const c = wb.addWorksheet("Please confirm");
        c.addRow(["Name", "Job on the list", "What I did, and what to check"]).font = { bold: true };
        for (const r of confirm) c.addRow([r.name, r.designation, r.note]);
        c.columns = [{ width: 26 }, { width: 28 }, { width: 90 }];
      }
      const file = path.join(DATA, `Employee_Logins_CONFIDENTIAL_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`);
      await wb.xlsx.writeFile(file);
      console.log(`\nLogins and passwords saved to (keep private):\n  ${file}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("\nStopped:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
