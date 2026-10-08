import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Inbox, TrendingUp, TrendingDown } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-xs font-medium text-brand-700 hover:underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3">
        <Inbox className="h-6 w-6 text-slate-400" />
      </div>
      <p className="font-medium text-slate-800">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  href,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  href?: string;
  trend?: "up" | "down";
}) {
  const ring = {
    default: "",
    good: "border-l-4 border-l-emerald-500",
    warn: "border-l-4 border-l-amber-500",
    bad: "border-l-4 border-l-red-500",
  }[tone];
  const body = (
    <div className={cn("h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow", ring, href && "hover:shadow-md")}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="tabular mt-1.5 flex items-center gap-1.5 text-2xl font-semibold text-slate-900">
        {value}
        {trend === "up" && <TrendingUp className="h-4 w-4 text-emerald-600" />}
        {trend === "down" && <TrendingDown className="h-4 w-4 text-red-600" />}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Progress({ value, className, tone }: { value: number; className?: string; tone?: "auto" | "brand" }) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone === "brand" ? "bg-brand-600" : v >= 100 ? "bg-emerald-500" : v >= 50 ? "bg-brand-600" : "bg-amber-500";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-100", className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "good"; children: React.ReactNode }) {
  const c = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    bad: "border-red-200 bg-red-50 text-red-900",
    good: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div className={cn("rounded-lg border px-4 py-3 text-sm", c)}>{children}</div>;
}

export function DetailGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{i.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{i.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TabLinks({ tabs, current }: { tabs: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium",
            current === t.key ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}
