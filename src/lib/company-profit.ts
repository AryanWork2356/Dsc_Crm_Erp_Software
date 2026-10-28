import "server-only";
import { db } from "./db";
import { projectFinancials } from "./project-finance";
import { num, round2 } from "./utils";

/**
 * Company profit, from completed projects only, month by month and year by year (financial year April to March).
 *
 *   Revenue        = contract value (excl. GST) of each COMPLETED project, in the month the project was completed
 *   Direct cost    = that project's booked cost (material, labour, vendors, project expenses), same month
 *   Gross profit   = Revenue − Direct cost
 *   Overheads      = approved expenses NOT tied to a project (office, travel, petty cash, misc), by expense date
 *                  + staff salaries from payslips (basic, HRA, allowances, overtime, incentives, bonus), by payslip month
 *   EBITDA         = Gross profit − Overheads  (before depreciation, interest and tax)
 *   Net profit     = EBITDA − Depreciation − Interest − Income tax
 *
 * The app does not know depreciation, interest or tax: Accounts types them in for each month (CompanyCharge). Until they are
 * typed in, Net profit equals EBITDA and the page says so.
 * Because a project's whole revenue and cost fall in the month it is completed, a month can look very good or very bad on its own;
 * the year is the fairer view. Salaries of site workers are already inside the project's direct cost, so they are not counted twice.
 */

export const CHARGE_KINDS = { DEPRECIATION: "Depreciation", INTEREST: "Interest on loans", TAX: "Income tax" } as const;
export type ChargeKind = keyof typeof CHARGE_KINDS;

const IST = 19800000; // +5:30
const parts = (d: Date) => { const x = new Date(d.getTime() + IST); return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1 }; };

/** Financial year that a date falls in, named by the year it starts (2026 = April 2026 to March 2027). */
export function fyOf(d: Date): number {
  const { year, month } = parts(d);
  return month >= 4 ? year : year - 1;
}
export const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** April … March of a financial year. */
export function fyMonths(fy: number): { key: string; year: number; month: number; label: string }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((i + 3) % 12) + 1;
    const year = month >= 4 ? fy : fy + 1;
    return { key: `${year}-${String(month).padStart(2, "0")}`, year, month, label: `${MONTHS[month - 1]} ${String(year).slice(2)}` };
  });
}
const key = (d: Date) => { const { year, month } = parts(d); return `${year}-${String(month).padStart(2, "0")}`; };

export type Cell = {
  projects: number; revenue: number;
  material: number; labour: number; vendor: number; otherDirect: number; directCost: number; grossProfit: number;
  officeCosts: number; salaries: number; overheads: number; ebitda: number;
  depreciation: number; interest: number; tax: number; netProfit: number;
};
const blank = (): Cell => ({ projects: 0, revenue: 0, material: 0, labour: 0, vendor: 0, otherDirect: 0, directCost: 0, grossProfit: 0, officeCosts: 0, salaries: 0, overheads: 0, ebitda: 0, depreciation: 0, interest: 0, tax: 0, netProfit: 0 });

function finish(c: Cell): Cell {
  c.directCost = round2(c.material + c.labour + c.vendor + c.otherDirect);
  c.grossProfit = round2(c.revenue - c.directCost);
  c.overheads = round2(c.officeCosts + c.salaries);
  c.ebitda = round2(c.grossProfit - c.overheads);
  c.netProfit = round2(c.ebitda - c.depreciation - c.interest - c.tax);
  return c;
}
export function sumCells(cells: Cell[]): Cell {
  const t = blank();
  for (const c of cells) for (const k of Object.keys(t) as (keyof Cell)[]) t[k] = round2(t[k] + c[k]);
  return finish(t);
}
export const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

export type ProfitProject = { id: string; code: string; name: string; clientId: string; clientName: string; completedOn: Date; fy: number; revenue: number; cost: number; profit: number };
export type ClientRollup = { clientId: string; name: string; poValue: number; poCount: number; projects: number; revenue: number; cost: number; profit: number };

export type CompanyProfit = {
  months: Map<string, Cell>;
  years: number[]; // financial years that have any data, newest first
  chargeMonths: Set<string>; // months where some depreciation/interest/tax has been typed in
  projects: ProfitProject[];
  orders: { poValue: number; poCount: number; revenue: number; cost: number; profit: number; byClient: ClientRollup[] };
};

export async function companyProfit(companyId: string): Promise<CompanyProfit> {
  const [done, expenses, payslips, charges, pos] = await Promise.all([
    db.project.findMany({ where: { companyId, status: "COMPLETED", deletedAt: null }, select: { id: true, code: true, name: true, clientId: true, actualEndDate: true, updatedAt: true, client: { select: { name: true } } } }),
    db.expense.findMany({ where: { companyId, projectId: null, approved: true }, select: { date: true, amount: true } }),
    db.payslip.findMany({ where: { companyId }, select: { month: true, year: true, basic: true, hra: true, allowances: true, overtime: true, incentives: true, bonus: true } }),
    db.companyCharge.findMany({ where: { companyId } }),
    db.clientPO.findMany({ where: { companyId, status: { not: "CANCELLED" } }, select: { clientId: true, amount: true, client: { select: { name: true } } } }),
  ]);
  const fin = await projectFinancials(companyId, done.map((p) => p.id));

  const months = new Map<string, Cell>();
  const cell = (k: string) => { let c = months.get(k); if (!c) { c = blank(); months.set(k, c); } return c; };

  const projects: ProfitProject[] = [];
  for (const p of done) {
    const f = fin.get(p.id);
    if (!f) continue;
    const when = p.actualEndDate ?? p.updatedAt;
    const c = cell(key(when));
    c.projects += 1; c.revenue = round2(c.revenue + f.contractValue);
    c.material = round2(c.material + f.material); c.labour = round2(c.labour + f.labour); c.vendor = round2(c.vendor + f.vendor); c.otherDirect = round2(c.otherDirect + f.other);
    projects.push({ id: p.id, code: p.code, name: p.name, clientId: p.clientId, clientName: p.client.name, completedOn: when, fy: fyOf(when), revenue: f.contractValue, cost: f.actualCost, profit: f.profit });
  }
  for (const e of expenses) { const c = cell(key(e.date)); c.officeCosts = round2(c.officeCosts + num(e.amount)); }
  for (const s of payslips) {
    const c = cell(`${s.year}-${String(s.month).padStart(2, "0")}`);
    c.salaries = round2(c.salaries + num(s.basic) + num(s.hra) + num(s.allowances) + num(s.overtime) + num(s.incentives) + num(s.bonus));
  }
  const chargeMonths = new Set<string>();
  for (const ch of charges) {
    const k = `${ch.year}-${String(ch.month).padStart(2, "0")}`;
    const c = cell(k);
    if (ch.kind === "DEPRECIATION") c.depreciation = round2(c.depreciation + num(ch.amount));
    else if (ch.kind === "INTEREST") c.interest = round2(c.interest + num(ch.amount));
    else if (ch.kind === "TAX") c.tax = round2(c.tax + num(ch.amount));
    chargeMonths.add(k);
  }
  for (const c of months.values()) finish(c);

  const years = [...new Set([...months.keys()].map((k) => { const [y, m] = k.split("-").map(Number); return m >= 4 ? y : y - 1; }))].sort((a, b) => b - a);

  // everything the clients have ordered, against what the completed projects of each client earned
  const byClient = new Map<string, ClientRollup>();
  const row = (id: string, name: string) => { let r = byClient.get(id); if (!r) { r = { clientId: id, name, poValue: 0, poCount: 0, projects: 0, revenue: 0, cost: 0, profit: 0 }; byClient.set(id, r); } return r; };
  for (const o of pos) { const r = row(o.clientId, o.client.name); r.poValue = round2(r.poValue + num(o.amount)); r.poCount += 1; }
  for (const p of projects) { const r = row(p.clientId, p.clientName); r.projects += 1; r.revenue = round2(r.revenue + p.revenue); r.cost = round2(r.cost + p.cost); r.profit = round2(r.profit + p.profit); }
  const list = [...byClient.values()].sort((a, b) => b.poValue - a.poValue || b.revenue - a.revenue);
  const orders = {
    poValue: round2(list.reduce((s, r) => s + r.poValue, 0)), poCount: list.reduce((s, r) => s + r.poCount, 0),
    revenue: round2(list.reduce((s, r) => s + r.revenue, 0)), cost: round2(list.reduce((s, r) => s + r.cost, 0)), profit: round2(list.reduce((s, r) => s + r.profit, 0)),
    byClient: list,
  };
  return { months, years, chargeMonths, projects: projects.sort((a, b) => b.completedOn.getTime() - a.completedOn.getTime()), orders };
}
