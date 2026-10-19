/**
 * Screen language. The app is written in English; Hindi, Marathi and Gujarati are shown by translating the page
 * in the browser (Google Translate, switched on by the "googtrans" cookie). Nothing is translated on our server.
 */
export const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "mr", label: "मराठी" },
  { code: "gu", label: "ગુજરાતી" },
] as const;
export type LangCode = (typeof LANGS)[number]["code"];

/** The language chosen in a cookie string such as "a=1; googtrans=/en/hi"; English when none or unknown. */
export function langFromCookie(cookie: string): LangCode {
  const m = /(?:^|;\s*)googtrans=\/[a-z-]+\/([a-z-]+)/i.exec(cookie || "");
  const code = m?.[1]?.toLowerCase();
  return LANGS.some((l) => l.code === code && l.code !== "en") ? (code as LangCode) : "en";
}

/** Cookie text that selects a language ("" clears it for English). */
export function cookieFor(code: LangCode): string {
  const base = "googtrans=" + (code === "en" ? "/en/en" : `/en/${code}`);
  return code === "en" ? `${base}; path=/; max-age=0` : `${base}; path=/; max-age=31536000; samesite=lax`;
}
