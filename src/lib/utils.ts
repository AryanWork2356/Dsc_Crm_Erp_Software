import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Numeric = number | string | { toString(): string } | null | undefined;

export function num(v: Numeric): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals (money) */
export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(v: Numeric, decimals = false) {
  return (decimals ? inr2 : inr).format(num(v));
}

/** Compact Indian format: 12.5L, 3.2Cr */
export function formatINRCompact(v: Numeric) {
  const n = num(v);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toDateInput(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Calendar-day key for @db.Date columns (e.g. attendance). Always UTC midnight of the intended calendar date,
 * so the stored date never shifts with the server's timezone.
 *  - "2030-03-04"  → that date
 *  - Date / none   → the LOCAL calendar date of that moment (today by default)
 */
export function calendarDay(d: Date | string = new Date()): Date {
  if (typeof d === "string") return new Date(d.slice(0, 10) + "T00:00:00.000Z");
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function humanize(s: string) {
  return s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
