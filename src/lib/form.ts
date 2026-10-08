import { z } from "zod";

/** FormData -> plain object. Empty strings become undefined so optional zod fields work. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t === "") continue;
    o[k] = t === "on" ? true : t === "off" ? false : t;
  }
  return o;
}

export const zReqStr = (msg = "Required") => z.string({ message: msg }).trim().min(1, msg);
export const zOptStr = z.string().trim().optional();
export const zNum = (msg = "Enter a valid number") => z.coerce.number({ message: msg });
export const zNumPos = (msg = "Must be 0 or more") => z.coerce.number({ message: "Enter a valid number" }).min(0, msg);
export const zOptNum = z.coerce.number({ message: "Enter a valid number" }).optional();
export const zDate = (msg = "Select a date") => z.coerce.date({ message: msg });
export const zOptDate = z.coerce.date({ message: "Invalid date" }).optional();
export const zEmail = z.string().trim().email("Enter a valid email").optional();
export const zPhone = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s-]{6,17}$/, "Enter a valid phone number")
  .optional();
export const zGstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN")
  .optional();
export const zPan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter a valid PAN (e.g. ABCDE1234F)")
  .optional();
