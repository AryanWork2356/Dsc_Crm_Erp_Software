import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // all tests share one seeded database; run files sequentially
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5434/dsc_erp_test",
      AUTH_SECRET: "test-secret-test-secret-test-secret-123456",
      UPLOAD_DIR: "./.test-uploads",
    },
  },
});
