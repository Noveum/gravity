import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3024",
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: "bun run dev -- --port 3024",
    url: "http://127.0.0.1:3024/files",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: "",
      CRM_DEMO_MODE: "true",
      APP_URL: "http://127.0.0.1:3024",
    },
  },
  outputDir: ".data/file-browser-results",
});
