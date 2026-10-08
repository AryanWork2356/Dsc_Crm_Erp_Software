import { describe, it, expect } from "vitest";
import { bucketFor, buildAging, BUCKETS } from "@/lib/aging";

const today = new Date("2030-06-30T00:00:00Z");
const d = (s: string) => new Date(s + "T00:00:00Z");

describe("aging", () => {
  it("puts amounts in the right bucket by days past due", () => {
    expect(bucketFor(d("2030-07-10"), d("2030-06-01"), today)).toBe(BUCKETS[0]);
    expect(bucketFor(d("2030-06-30"), d("2030-06-01"), today)).toBe(BUCKETS[0]); // due today = not yet overdue
    expect(bucketFor(d("2030-06-20"), d("2030-06-01"), today)).toBe(BUCKETS[1]);
    expect(bucketFor(d("2030-05-20"), d("2030-05-01"), today)).toBe(BUCKETS[2]);
    expect(bucketFor(d("2030-04-20"), d("2030-04-01"), today)).toBe(BUCKETS[3]);
    expect(bucketFor(d("2030-01-01"), d("2029-12-01"), today)).toBe(BUCKETS[4]);
  });
  it("falls back to the issue date when there is no due date", () => {
    expect(bucketFor(null, d("2030-05-01"), today)).toBe(BUCKETS[2]);
  });
  it("totals per party and ignores settled balances", () => {
    const rows = buildAging([
      { partyId: "a", partyName: "A", balance: 1000, dueDate: d("2030-06-20"), issueDate: d("2030-06-01") },
      { partyId: "a", partyName: "A", balance: 500, dueDate: d("2030-01-01"), issueDate: d("2029-12-01") },
      { partyId: "b", partyName: "B", balance: 0, dueDate: d("2030-06-20"), issueDate: d("2030-06-01") },
      { partyId: "c", partyName: "C", balance: 9000, dueDate: d("2030-07-30"), issueDate: d("2030-06-01") },
    ], today);
    expect(rows.map((r) => r.id)).toEqual(["c", "a"]);
    expect(rows[1].total).toBe(1500);
    expect(rows[1].buckets["1–30 days"]).toBe(1000);
    expect(rows[1].buckets["90+ days"]).toBe(500);
    expect(rows[1].count).toBe(2);
  });
});
