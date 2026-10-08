import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font files from disk at runtime, so it must not be bundled
  serverExternalPackages: ["pdfkit", "exceljs"],
  experimental: {
    // allow image/document uploads up to 12 MB through server actions
    serverActions: { bodySizeLimit: "12mb" },
  },
  poweredByHeader: false,
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
    ];
  },
};

export default nextConfig;
