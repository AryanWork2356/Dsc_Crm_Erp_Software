import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The phone app is a native shell around the hosted DSC web app – every screen, rule and report is the website, so a fix
 * on the website reaches every phone at once. Set CAP_SERVER_URL to the live address (https only) before syncing:
 *   set CAP_SERVER_URL=https://your-dsc-site.vercel.app   &&   npx cap sync
 */
const url = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.dscinterior.app",
  appName: "DSC Interior",
  webDir: "www", // only holds the "not connected" fallback page
  backgroundColor: "#14244a",
  server: url ? { url, cleartext: false, androidScheme: "https" } : undefined,
  android: { allowMixedContent: false },
  ios: { contentInset: "automatic", backgroundColor: "#14244a" },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, backgroundColor: "#14244a", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#14244a" },
  },
};

export default config;
