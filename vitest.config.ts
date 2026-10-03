import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // SQL and local-file fixtures are explicit test configuration, never runtime auth.
    env: { CRM_DEMO_MODE: "true", DATABASE_URL: "" },
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@crm": new URL("./packages", import.meta.url).pathname },
  },
});
