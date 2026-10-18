import { istParts } from "./site-reports";

/**
 * SOP: material must be requested at least 2–3 days before it is needed.
 * Whole calendar days (India time) between today and the required date.
 */
export function daysNotice(requiredDate: Date | string, now: Date = new Date()): number {
  const req = new Date(typeof requiredDate === "string" ? requiredDate.slice(0, 10) + "T00:00:00.000Z" : requiredDate.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const today = new Date(istParts(now).date + "T00:00:00.000Z");
  return Math.round((req.getTime() - today.getTime()) / 86400000);
}

export const isShortNotice = (requiredDate: Date | string | null | undefined, minDays: number, now: Date = new Date()) =>
  !!requiredDate && daysNotice(requiredDate, now) < minDays;
