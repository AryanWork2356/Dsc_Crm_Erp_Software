import { randomInt } from "node:crypto";

/**
 * Passwords that DSC gives out: the person's first name, then @, then a number (and a ! for the money and management roles).
 *   Gopal@48271         most people
 *   Dinesh@482913!      Owner, directors, Admin, Accounts and HR (a longer number and a !)
 * The number is random for each person, so the name alone does not give the password away. The app keeps only a scrambled
 * copy, so the list of issued passwords (the Excel file) is the company's record. If a person forgets theirs, the Admin looks
 * it up there, or resets it, which makes a new one in the same style.
 */
const STRONG_ROLES = ["OWNER", "MANAGEMENT", "ADMIN", "ACCOUNTS", "HR"];

/** "Mohd. Shamshad Alam" → "Shamshad", "Test login: Project Manager" → "ProjectManager". Letters only, first letter capital. */
export function givenName(name: string): string {
  if (name.startsWith("Test login:")) return name.slice(11).replace(/[^A-Za-z]/g, "");
  const parts = name.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (parts[0]?.toLowerCase() === "mohd" && parts.length > 1) parts.shift();
  const first = parts[0] ?? "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function issuedPassword(name: string, role?: string): string {
  const n = givenName(name) || "Dsc";
  return role && STRONG_ROLES.includes(role) ? `${n}@${randomInt(100000, 1000000)}!` : `${n}@${randomInt(10000, 100000)}`;
}
