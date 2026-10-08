export const BUCKETS = ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "90+ days"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Which aging bucket an unpaid amount falls into, by days past its due date. */
export function bucketFor(dueDate: Date | null, issueDate: Date, today: Date): Bucket {
  const due = dueDate ?? issueDate;
  const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
  if (days <= 0) return BUCKETS[0];
  if (days <= 30) return BUCKETS[1];
  if (days <= 60) return BUCKETS[2];
  if (days <= 90) return BUCKETS[3];
  return BUCKETS[4];
}

export type AgingRow = { id: string; name: string; buckets: Record<Bucket, number>; total: number; count: number };

/** Groups open balances per party (client/vendor) into aging buckets. */
export function buildAging(items: { partyId: string; partyName: string; balance: number; dueDate: Date | null; issueDate: Date }[], today: Date): AgingRow[] {
  const map = new Map<string, AgingRow>();
  for (const i of items) {
    if (i.balance <= 0.005) continue;
    const r = map.get(i.partyId) ?? { id: i.partyId, name: i.partyName, buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>, total: 0, count: 0 };
    r.buckets[bucketFor(i.dueDate, i.issueDate, today)] += i.balance;
    r.total += i.balance;
    r.count++;
    map.set(i.partyId, r);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
