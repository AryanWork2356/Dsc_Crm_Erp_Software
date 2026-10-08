import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Separate from the normal suite: `npm run perf` (needs `npm run db:start`)
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globalSetup: ["./tests-perf/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    include: ["tests-perf/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 600000,
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5434/dsc_erp_perf",
      AUTH_SECRET: "perf-secret-perf-secret-perf-secret-123456",
      UPLOAD_DIR: "./.test-uploads",
    },
  },
});
