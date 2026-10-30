import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font files from disk at runtime, so it must not be bundled
  serverExternalPackages: ["pdfkit", "exceljs"],
  experimental: {
    // allow image/document uploads up to 12 MB through server actions
    serverActions: { bodySizeLimit: "12mb" },
  },
  poweredByHeader: false,
  // Next.js streams the page metadata (title, manifest link, icons) into the BODY for normal browsers. Chrome then ignores the
  // manifest link and never offers to install the app, and iPhone ignores the home-screen icon. Send it in the HEAD for everyone.
  htmlLimitedBots: /.*/,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
        ],
      },
      // the service worker must always be fetched fresh so updates reach phones quickly
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
    ];
  },
};

export default nextConfig;
