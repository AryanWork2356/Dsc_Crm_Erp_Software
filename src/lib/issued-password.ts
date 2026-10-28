import { randomInt } from "node:crypto";

/**
 * Login IDs and passwords that DSC gives out, kept short on purpose.
 *
 *   Login ID   first name + first letter of the surname:        gopals       (Gopal Sharma)
 *              if two people would get the same one, the surname grows by one letter:  gopalsh
 *   Password   first three letters of the first name, @, two random digits:   Gop@47
 *
 * "Mohd" in front of a name is ignored (Mohd. Shamshad Alam is shamshada, Mohd Kaif is kaif).
 * The app adds @dscinterior.com by itself when someone types only the short ID.
 *
 * Only two random digits is easy to type and remember, and also easy to guess if somebody knows a name. The app therefore
 * locks a login for 15 minutes after 5 wrong passwords and tells the Owner and Admin (see the sign-in action).
 * The app keeps only a scrambled copy of every password, so the Excel file of issued passwords is the company's record.
 */
export const LOGIN_DOMAIN = "dscinterior.com";

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
    const id = `${given}${surname.slice(0, n)}@${LOGIN_DOMAIN}`;
    if (!taken.has(id)) { taken.add(id); return id; }
  }
  for (let k = 2; ; k++) {
    const id = `${given}${surname}${k}@${LOGIN_DOMAIN}`;
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}

/** What a person types at sign-in becomes a full ID: "gopals" → "gopals@dscinterior.com"; a full e-mail is left as it is. */
export function fullLoginId(typed: string): string {
  const t = typed.trim().toLowerCase();
  return t.includes("@") ? t : `${t}@${LOGIN_DOMAIN}`;
}

/** First three letters of the first name, @, two random digits. */
export function issuedPassword(name: string): string {
  const n = givenName(name) || "Dsc";
  return `${n.slice(0, 3)}@${randomInt(10, 100)}`;
}
