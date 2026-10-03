import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@crm": new URL("./packages", import.meta.url).pathname },
  },
});
