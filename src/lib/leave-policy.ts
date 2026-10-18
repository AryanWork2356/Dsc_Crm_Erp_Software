import type { LeaveKind } from "@prisma/client";

/**
 * Leave rules from the DSC Code of Conduct:
 *   - Regular leave (1–3 days): 15 days' notice to the reporting manager and HR.
 *   - Long leave (festival / family function / personal, or more than 3 days): 3 months' notice; needs Management approval.
 *   - Medical / emergency: inform at once; supporting documents on request.
 *   - No employee gets more than 30 days of leave in a calendar year; beyond that needs the Managing Director's written approval.
 * The numbers are company settings.
 */
export type LeavePolicy = { noticeDays: number; longNoticeDays: number; yearlyCap: number };
export const DEFAULT_LEAVE_POLICY: LeavePolicy = { noticeDays: 15, longNoticeDays: 90, yearlyCap: 30 };
export const REGULAR_MAX_DAYS = 3;
export const URGENT_BACKDATE_DAYS = 7; // medical / emergency leave may be applied for up to a week after it began

export type LeaveVerdict = {
  kind: LeaveKind; // what the request really is (a "regular" request over 3 days is long leave)
  error: string | null;
  requiredRole: "HR" | "MANAGEMENT" | "OWNER";
  exceedsCap: boolean;
  note: string | null;
};

export function evaluateLeave(i: { kind: LeaveKind; days: number; noticeDays: number; usedThisYear: number; policy: LeavePolicy }): LeaveVerdict {
  const { policy: p } = i;
  const urgent = i.kind === "MEDICAL" || i.kind === "EMERGENCY";
  const kind: LeaveKind = urgent ? i.kind : i.kind === "LONG" || i.days > REGULAR_MAX_DAYS ? "LONG" : "REGULAR";
  let error: string | null = null;

  if (urgent) {
    if (i.noticeDays < -URGENT_BACKDATE_DAYS) error = `${kind === "MEDICAL" ? "Medical" : "Emergency"} leave must be reported within ${URGENT_BACKDATE_DAYS} days of the first day.`;
  } else {
    const need = kind === "LONG" ? p.longNoticeDays : p.noticeDays;
    if (i.noticeDays < need) {
      const months = Math.round(need / 30);
      const label = kind === "LONG" ? `Long leave (more than ${REGULAR_MAX_DAYS} days, festival or personal reasons)` : `Regular leave (1–${REGULAR_MAX_DAYS} days)`;
      error = `${label} needs ${need >= 60 ? `${months} months'` : `${need} days'`} notice – you have given ${Math.max(0, i.noticeDays)} day(s). For a medical problem or emergency, choose that leave type instead.`;
    }
  }
  const exceedsCap = i.usedThisYear + i.days > p.yearlyCap;
  const requiredRole = exceedsCap ? "OWNER" : kind === "LONG" ? "MANAGEMENT" : "HR";
  const note = exceedsCap
    ? `This takes the year's leave to ${i.usedThisYear + i.days} days (limit ${p.yearlyCap}). It needs the Managing Director's written approval.`
    : kind === "MEDICAL" ? "A medical certificate may be asked for."
    : null;
  return { kind, error, requiredRole, exceedsCap, note };
}
