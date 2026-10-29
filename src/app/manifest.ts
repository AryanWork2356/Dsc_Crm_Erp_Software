import type { MetadataRoute } from "next";

/** Makes the site installable on a phone ("Add to Home Screen") – opens full screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DSC Interior",
    short_name: "DSC",
    description: "DSC Interior – projects, site reports, material, billing and approvals in one place.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#361210",
    theme_color: "#14244a",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Send site report", short_name: "Site report", url: "/site-reports", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Time limits", short_name: "Time limits", url: "/time-limits", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Approvals", short_name: "Approvals", url: "/approvals", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
