import { defineConfig } from "@playwright/test";

const port = Number(process.env.GRAVITY_TEST_PORT ?? 3024);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "tests/browser",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL,
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `bun run dev -- --port ${port}`,
    url: `${baseURL}/files`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: "",
      CRM_DEMO_MODE: "true",
      APP_URL: baseURL,
    },
  },
  outputDir: ".data/file-browser-results",
});
