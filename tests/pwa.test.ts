import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import manifest from "@/app/manifest";
import { middleware } from "@/middleware";

const pub = (p: string) => path.join(process.cwd(), "public", p);

describe("installable app (PWA)", () => {
  it("the manifest makes the site open full screen with the DSC icons", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.theme_color).toBe("#14244a");
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
    for (const i of m.icons ?? []) expect(fs.existsSync(pub(i.src)), i.src).toBe(true);
    expect(m.shortcuts?.map((s) => s.url)).toEqual(["/site-reports", "/time-limits", "/approvals"]);
  });

  it("the icons are real PNG files of the declared size", () => {
    for (const [file, size] of [["icons/icon-192.png", 192], ["icons/icon-512.png", 512], ["icons/icon-maskable-512.png", 512], ["icons/apple-touch-icon.png", 180]] as const) {
      const b = fs.readFileSync(pub(file));
      expect([...b.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(b.readUInt32BE(16), file).toBe(size); // width in the PNG header
    }
  });

  it("the service worker caches app files only – never pages, data or downloads", () => {
    const sw = fs.readFileSync(pub("sw.js"), "utf8");
    expect(sw).toMatch(/req\.mode === "navigate"/);
    expect(sw).toMatch(/fetch\(req\)\.catch\(\(\) => caches\.match\(OFFLINE\)\)/); // pages: network first, offline screen on failure
    expect(sw).toMatch(/\/_next\/static\//);
    expect(sw).not.toMatch(/\/api\//);
    expect(sw).toMatch(/req\.method !== "GET"/); // writes are never intercepted
    expect(fs.existsSync(pub("offline.html"))).toBe(true);
    expect(fs.readFileSync(pub("offline.html"), "utf8")).toMatch(/Try again/);
  });

  it("the manifest, service worker and offline screen load before sign-in; private pages still need a login", async () => {
    for (const p of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/install"]) {
      const r = await middleware(new NextRequest(`http://localhost${p}`));
      expect(r.status, p).toBe(200); // passes through (NextResponse.next)
      expect(r.headers.get("location"), p).toBeNull();
    }
    const priv = await middleware(new NextRequest("http://localhost/dashboard"));
    expect(priv.status).toBe(307);
    expect(priv.headers.get("location")).toContain("/login");
  });
});
