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
 *   - creates a login (ID + new random password) and an employee record for every person who has an app role;
 *   - people with no matching app role get an employee record only (no login) and are listed for confirmation;
 *   - creates the clients, suppliers and contractors (contractors are vendors);
 *   - renames the old test logins (@dsc.demo) to "Test login: <role>" and gives each a NEW random password, so the
 *     well-known demo password stops working on the online system. The logins themselves are kept.
 *   - passwords are the company style: first name, @, a number (Gopal@48271); Owner, directors, Admin, Accounts and HR also get a longer number and a ! . Nobody is asked to change it; the Admin can reset any.
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
import { issuedPassword } from "../src/lib/issued-password";

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

/** The Owner and directors already had logins (under the old @dsc.demo address). They keep those IDs and get their real names back. */
const OWNERS: Record<string, { name: string; designation: string }> = {
  "dinesh@dsc.demo": { name: "Dinesh Sharma", designation: "Owner" },
  "gopal@dsc.demo": { name: "Gopal Sharma", designation: "Director" },
  "director@dsc.demo": { name: "Satish Sharma", designation: "Director" },
};
const OWNER_NAMES = new Set(Object.values(OWNERS).map((o) => o.name));

function loginId(name: string, taken: Set<string>): string {
  const t = name.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (t[0] === "mohd" && t.length > 2) t.shift();
  const base = t.length > 1 ? `${t[0]}.${t[t.length - 1]}` : t[0];
  let id = `${base}@${DOMAIN}`;
  for (let n = 2; taken.has(id); n++) id = `${base}${n}@${DOMAIN}`;
  taken.add(id);
  return id;
}

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
  const people = JSON.parse(fs.readFileSync(path.join(DATA, "employees.json"), "utf8")) as { sr: number; name: string; designation: string | null; role: RoleKey | null; confirm?: string }[];
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

    const cred: { sr: number; name: string; designation: string; role: string; id: string; pw: string }[] = [];
    const noLogin: { name: string; designation: string; why: string }[] = [];
    const confirm: { name: string; designation: string; note: string }[] = [];
    let newUsers = 0, newEmployees = 0, skipped = 0;

    const nextEmp = async (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => {
      for (let i = 0; i < 500; i++) {
        const row = await tx.sequence.upsert({ where: { companyId_key: { companyId: cid, key: "EMP" } }, create: { companyId: cid, key: "EMP", value: 1 }, update: { value: { increment: 1 } } });
        const code = `EMP-${String(row.value).padStart(3, "0")}`;
        if (!(await tx.employee.findFirst({ where: { companyId: cid, code }, select: { id: true } }))) return code;
      }
      throw new Error("No free employee code");
    };

    // 1. staff
    for (const p of people) {
      if (p.confirm) confirm.push({ name: p.name, designation: p.designation ?? "(none written)", note: p.confirm });
      // a person who is already here (as an employee, or as a login that data:clear kept) is never created twice
      if (OWNER_NAMES.has(p.name)) { skipped++; continue; } // already has a login: handled with the Owner and directors below
      const already = (await prisma.employee.findFirst({ where: { companyId: cid, name: p.name, deletedAt: null }, select: { id: true } })) ?? (await prisma.user.findFirst({ where: { companyId: cid, name: p.name, deletedAt: null }, select: { id: true } }));
      if (already) { skipped++; continue; }
      const id = p.role ? loginId(p.name, taken) : null;
      const pw = p.role ? issuedPassword(p.name, p.role) : null;
      if (!p.role) noLogin.push({ name: p.name, designation: p.designation ?? "(none written)", why: p.confirm ?? "" });
      if (dry) { console.log(`  would add ${p.name} (${p.designation ?? "-"}) ${p.role ? `as ${ROLE_LABEL[p.role]} → ${id}` : "– employee record only"}`); continue; }
      await prisma.$transaction(async (tx) => {
        const user = p.role && id && pw ? await tx.user.create({ data: { companyId: cid, email: id, name: p.name, role: p.role, passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: false } }) : null;
        const code = await nextEmp(tx);
        await tx.employee.create({ data: { companyId: cid, userId: user?.id ?? null, code, name: p.name, email: id, designation: p.designation, status: "ACTIVE" } });
        if (user) newUsers++;
        newEmployees++;
      });
      if (p.role && id && pw) cred.push({ sr: p.sr, name: p.name, designation: p.designation ?? "", role: ROLE_LABEL[p.role] ?? p.role, id, pw });
    }

    // 2a. the Owner and directors: keep their IDs, restore their real names, and make sure they have an employee record
    const owners: { name: string; designation: string; id: string; pw: string | null }[] = [];
    for (const u of existing.filter((x) => OWNERS[x.email.toLowerCase()])) {
      const o = OWNERS[u.email.toLowerCase()];
      const fresh = !u.mustChangePassword && !u.passwordChangedAt; // still on the old shared password
      const pw = fresh ? issuedPassword(o.name, u.role) : null;
      if (!dry) {
        await prisma.user.update({ where: { id: u.id }, data: { name: o.name, ...(pw ? { passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: false } : {}) } });
        const emp = await prisma.employee.findFirst({ where: { companyId: cid, userId: u.id } });
        if (emp) await prisma.employee.update({ where: { id: emp.id }, data: { name: o.name, designation: o.designation } });
        else await prisma.$transaction(async (tx) => { const code = await nextEmp(tx); await tx.employee.create({ data: { companyId: cid, userId: u.id, code, name: o.name, email: u.email, designation: o.designation, status: "ACTIVE" } }); });
      }
      owners.push({ name: o.name, designation: o.designation, id: u.email, pw });
    }

    // 2. the old test logins: kept, renamed, and given a new password so the well-known one stops working
    const tests: { name: string; role: string; id: string; pw: string }[] = [];
    for (const u of existing.filter((x) => x.email.toLowerCase().endsWith("@dsc.demo") && !OWNERS[x.email.toLowerCase()] && !x.name.startsWith("Test login:")).sort((a, b) => a.email.localeCompare(b.email))) { // already done once: leave them alone
      const label = ROLE_LABEL[u.role] ?? u.role;
      const pw = issuedPassword(`Test login: ${label}`, u.role);
      if (!dry) await prisma.user.update({ where: { id: u.id }, data: { name: `Test login: ${label}`, passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: false } });
      tests.push({ name: `Test login: ${label}`, role: label, id: u.email, pw });
    }

    // 2b. --reissue: give EVERY staff login a fresh password in the company style (Name@number). Old ones stop working.
    if (process.argv.includes("--reissue")) {
      cred.length = 0; owners.length = 0; tests.length = 0;
      const staff = await prisma.user.findMany({ where: { companyId: cid, deletedAt: null, isActive: true, role: { notIn: ["WORKER", "CLIENT", "VENDOR"] } }, orderBy: { createdAt: "asc" } });
      for (const u of staff) {
        const pw = issuedPassword(u.name, u.role);
        if (!dry) await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(pw, 11), mustChangePassword: false, resetRequestedAt: null } });
        const e = u.email.toLowerCase();
        const label = ROLE_LABEL[u.role] ?? u.role;
        if (OWNERS[e]) owners.push({ name: u.name, designation: OWNERS[e].designation, id: u.email, pw });
        else if (e.endsWith("@dsc.demo")) tests.push({ name: u.name, role: label, id: u.email, pw });
        else { const p = people.find((x) => x.name === u.name); cred.push({ sr: p?.sr ?? 99, name: u.name, designation: p?.designation ?? "", role: label, id: u.email, pw }); }
      }
      console.log(`Re-issued ${staff.length} passwords${dry ? " (dry run: not changed)" : ""}.`);
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

    console.log(`\n${dry ? "Would create" : "Created"}: ${dry ? "" : `${newUsers} logins, ${newEmployees} employee records, ${clients} clients, ${vendors} vendors/suppliers.`}`);
    if (skipped) console.log(`Skipped ${skipped} people who already exist.`);
    if (owners.length) console.log(`Owner and directors: ${owners.map((o) => o.name).join(", ")} (names restored${owners.some((o) => o.pw) ? ", new passwords in the file" : "; passwords unchanged"})`);
    console.log(`Test logins renamed and given new passwords: ${tests.length}${dry ? " (dry run: not changed)" : ""}`);
    if (noLogin.length) console.log(`Employee record only (no login): ${noLogin.map((n) => n.name).join(", ")}`);

    if (!dry && (cred.length || tests.length || owners.some((x) => x.pw))) {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Employee logins");
      ws.addRow(["CONFIDENTIAL: DSC app logins. Give each person only their own line, then delete this file."]).font = { bold: true, color: { argb: "FFB91C1C" } };
      ws.addRow([`Sign in at ${SIGN_IN}   ·   The app keeps only scrambled copies, so keep this file safe: it is how you tell someone their password. Lost? The Admin presses Reset password.`]);
      ws.addRow([]);
      const head = ws.addRow(["Sr", "Name", "Job", "Role in the app", "Login ID", "Password"]);
      head.font = { bold: true, color: { argb: "FFFFFFFF" } };
      head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2A52" } }; });
      for (const o of owners.filter((x) => x.pw)) ws.addRow(["", o.name, o.designation, o.designation === "Owner" ? "Owner" : "Management", o.id, o.pw]);
      for (const r of cred.sort((a, b) => a.sr - b.sr)) ws.addRow([r.sr, r.name, r.designation, r.role, r.id, r.pw]);
      ws.columns = [{ width: 5 }, { width: 26 }, { width: 28 }, { width: 18 }, { width: 38 }, { width: 16 }];
      if (noLogin.length) {
        ws.addRow([]);
        ws.addRow(["No login yet (employee record only):"]).font = { bold: true };
        for (const n of noLogin) ws.addRow(["", n.name, n.designation, "", n.why]);
      }
      if (tests.length) {
        const t = wb.addWorksheet("Test logins (private)");
        t.addRow(["PRIVATE: for the Owner only. The old demo password no longer works on these."]).font = { bold: true, color: { argb: "FFB91C1C" } };
        t.addRow([]);
        t.addRow(["Name", "Role", "Login ID", "Password"]).font = { bold: true };
        for (const r of tests) t.addRow([r.name, r.role, r.id, r.pw]);
        t.columns = [{ width: 30 }, { width: 18 }, { width: 28 }, { width: 16 }];
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
