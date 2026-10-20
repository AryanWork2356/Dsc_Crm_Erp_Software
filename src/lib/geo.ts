/**
 * Location check for self-marked attendance. The phone sends where it is; the server compares that with the
 * saved position of the site or office. Plain functions, no database, so they are easy to test.
 */
export const DEFAULT_RADIUS_M = 20;
/** A phone that says it is only sure to within this many metres is not trusted. */
export const MAX_ACCURACY_M = 50;
/** A position older than this is a cached one, not where the person is now. */
export const MAX_FIX_AGE_MS = 2 * 60 * 1000;

export type Point = { lat: number; lng: number };
export type Fix = Point & { accuracyM?: number | null; at?: number | null };

/** Straight-line distance in metres between two points on the earth (haversine). */
export function distanceM(a: Point, b: Point): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const validPoint = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export type Verdict =
  | { ok: true; distanceM: number; accuracyM: number | null }
  | { ok: false; code: "NO_FIX" | "STALE" | "WEAK" | "FAR"; message: string; distanceM?: number };

export function checkPresence(fix: Fix | null, target: Point, radiusM: number, now = Date.now()): Verdict {
  if (!fix || !validPoint(fix.lat, fix.lng)) return { ok: false, code: "NO_FIX", message: "Location is needed to mark attendance. Turn on location on your phone and allow it for this app." };
  if (fix.at != null && now - fix.at > MAX_FIX_AGE_MS) return { ok: false, code: "STALE", message: "Your location is old. Wait a few seconds and press the button again." };
  const accuracyM = fix.accuracyM != null && Number.isFinite(fix.accuracyM) ? Math.round(fix.accuracyM) : null;
  if (accuracyM !== null && accuracyM > MAX_ACCURACY_M) return { ok: false, code: "WEAK", message: `The phone's location is not clear (about ${accuracyM} m off). Go to an open place, wait a few seconds and try again.` };
  const d = Math.round(distanceM(fix, target));
  if (d > radiusM) return { ok: false, code: "FAR", distanceM: d, message: `You are about ${d} m from the site. Marking is allowed only within ${radiusM} m.` };
  return { ok: true, distanceM: d, accuracyM };
}
