import { randomInt } from "node:crypto";

/**
 * Login IDs and passwords that DSC gives out, kept short on purpose.
 *
 *   Login ID   first name, a dot, first letter of the surname:   gopal.s@dsc   (Gopal Sharma)
 *              if two people would get the same one, the surname grows by one letter:  gopal.sh@dsc
 *   Password   four random digits:   4827
 *
 * "Mohd" in front of a name is ignored (Mohd. Shamshad Alam is shamshada, Mohd Kaif is kaif).
 * People type "gopal.s@dsc" (or just "gopal.s"); the app stores it as gopal.s@dscinterior.com.
 *
 * Four digits are easy to type and remember, and also easy to guess if somebody knows a name. The app therefore
 * locks a login for 15 minutes after 5 wrong passwords and tells the Owner and Admin (see the sign-in action).
 * The app keeps only a scrambled copy of every password, so the Excel file of issued passwords is the company's record.
 */
export const LOGIN_DOMAIN = "dscinterior.com";
/** What people see and type: "@dsc" instead of the full "@dscinterior.com". */
export const SHORT_DOMAIN = "dsc";

/** The words of a name, without the common "Mohd" in front. */
function words(name: string): string[] {
  if (name.startsWith("Test login:")) return [name.slice(11).replace(/[^A-Za-z]/g, "")];
  const parts = name.replace(/[^A-Za-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (parts[0]?.toLowerCase() === "mohd" && parts.length > 1) parts.shift();
  return parts;
}

/** "Mohd. Shamshad Alam" → "Shamshad", "Test login: Project Manager" → "ProjectManager". Letters only, first letter capital. */
export function givenName(name: string): string {
  const first = words(name)[0] ?? "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** The next free short login ID for a person. `taken` holds the IDs (full e-mail form) already in use, and is added to. */
export function loginIdFor(name: string, taken: Set<string>): string {
  const w = words(name);
  const given = (w[0] ?? "user").toLowerCase();
  const surname = w.length > 1 ? w[w.length - 1].toLowerCase() : "";
  for (let n = surname ? 1 : 0; n <= surname.length; n++) {
    const id = `${given}${n ? `.${surname.slice(0, n)}` : ""}@${LOGIN_DOMAIN}`;
    if (!taken.has(id)) { taken.add(id); return id; }
  }
  for (let k = 2; ; k++) {
    const id = `${given}${surname ? `.${surname}` : ""}${k}@${LOGIN_DOMAIN}`;
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}

/** What a person types at sign-in becomes a full ID: "gopal.s" or "gopal.s@dsc" → "gopal.s@dscinterior.com"; any other e-mail is left as it is. */
export function fullLoginId(typed: string): string {
  const t = typed.trim().toLowerCase();
  if (t.endsWith(`@${SHORT_DOMAIN}`)) return `${t.slice(0, -SHORT_DOMAIN.length - 1)}@${LOGIN_DOMAIN}`;
  return t.includes("@") ? t : `${t}@${LOGIN_DOMAIN}`;
}

/** How a login ID is shown: "gopal.s@dscinterior.com" → "gopal.s@dsc". */
export function shortLoginId(email: string): string {
  return email.toLowerCase().endsWith(`@${LOGIN_DOMAIN}`) ? `${email.slice(0, -LOGIN_DOMAIN.length - 1)}@${SHORT_DOMAIN}` : email;
}

/** Four random digits (never four of the same digit, never 1234 / 4321). The name is not used: it would make it easier to guess. */
export function issuedPassword(_name?: string): string {
  for (;;) {
    const p = String(randomInt(0, 10000)).padStart(4, "0");
    if (!/^(\d)\1{3}$/.test(p) && p !== "1234" && p !== "4321") return p;
  }
}
