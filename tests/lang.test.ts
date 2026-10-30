import { describe, it, expect } from "vitest";
import { LANGS, cookieFor, langFromCookie } from "@/lib/lang";

describe("screen language", () => {
  it("reads the chosen language from the cookie, English when absent or unknown", () => {
    expect(langFromCookie("")).toBe("en");
    expect(langFromCookie("a=1; googtrans=/en/hi")).toBe("hi");
    expect(langFromCookie("googtrans=/en/mr; b=2")).toBe("mr");
    expect(langFromCookie("googtrans=/en/gu")).toBe("gu");
    expect(langFromCookie("googtrans=/en/fr")).toBe("en");
    expect(langFromCookie("googtrans=/en/en")).toBe("en");
    expect(langFromCookie("xgoogtrans=/en/hi")).toBe("en");
  });
  it("builds a cookie that round-trips, and clears it for English", () => {
    for (const l of LANGS.filter((x) => x.code !== "en")) expect(langFromCookie(cookieFor(l.code))).toBe(l.code);
    expect(cookieFor("en")).toContain("max-age=0");
    expect(LANGS.map((l) => l.code)).toEqual(["en", "hi", "mr", "gu", "bho"]);
  });
});
