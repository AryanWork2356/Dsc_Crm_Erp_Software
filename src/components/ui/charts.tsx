"use client";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINRCompact } from "@/lib/utils";

// One validated, colour-blind-safe palette used by every chart in the app.
export const PALETTE = ["#284f8d", "#c8872e", "#2f9e8f", "#8b5cf6", "#d9534f", "#64748b", "#5bb0e0", "#a3a847"];
const AXIS = { fontSize: 12, fill: "#64748b" };

function useMounted() {
  const [m, setM] = React.useState(false);
  React.useEffect(() => setM(true), []);
  return m;
}

const Box = ({ h, children }: { h: number; children: React.ReactNode }) => <div style={{ height: h }} className="w-full">{children}</div>;

export function MoneyBars({ data, series, height = 260, stacked = false }: { data: Record<string, string | number>[]; series: { key: string; label: string; color?: string }[]; height?: number; stacked?: boolean }) {
  const mounted = useMounted();
  if (!mounted) return <Box h={height}>{null}</Box>;
  return (
    <Box h={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => formatINRCompact(v)} width={64} />
          <Tooltip formatter={(v) => formatINRCompact(Number(v))} cursor={{ fill: "#f1f5f9" }} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} stackId={stacked ? "a" : undefined} maxBarSize={36} />)}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function TrendLine({ data, series, height = 260 }: { data: Record<string, string | number>[]; series: { key: string; label: string; color?: string }[]; height?: number }) {
  const mounted = useMounted();
  if (!mounted) return <Box h={height}>{null}</Box>;
  return (
    <Box h={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => formatINRCompact(v)} width={64} />
          <Tooltip formatter={(v) => formatINRCompact(Number(v))} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={{ r: 3 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function Donut({ data, height = 240, money = false }: { data: { name: string; value: number }[]; height?: number; money?: boolean }) {
  const mounted = useMounted();
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!mounted) return <Box h={height}>{null}</Box>;
  if (!total) return <p className="py-16 text-center text-sm text-slate-500">No data yet</p>;
  return (
    <Box h={height}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="none">
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => (money ? formatINRCompact(Number(v)) : String(v))} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
}

/** Horizontal bar list (sales funnel, spending by vendor…) – labels stay readable at any width. */
export function HBars({ data, money = false }: { data: { name: string; value: number }[]; money?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-500">No data yet</p>;
  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => (
        <li key={d.name}>
          <div className="mb-1 flex justify-between text-sm"><span className="truncate pr-2 text-slate-700">{d.name}</span><span className="tabular font-medium text-slate-900">{money ? formatINRCompact(d.value) : d.value}</span></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div>
        </li>
      ))}
    </ul>
  );
}
