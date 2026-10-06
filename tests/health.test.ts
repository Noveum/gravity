import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createLocalDatabase } from "../packages/database/client";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let demo = false;
vi.mock("@crm/database/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDatabase: async () => local.db,
  isDemoMode: () => demo,
}));

import { GET } from "../src/app/api/health/route";

beforeAll(async () => {
  local = await createLocalDatabase();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  demo = false;
});
afterAll(async () => local.client.close());

function configure() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "fictional-google-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fictional-google-secret");
  for (const key of [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "RESEND_API_KEY",
    "EMAIL_FROM",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "fictional-health-test-secret-32-characters",
  );
  vi.stubEnv("APP_URL", "https://gravity.example.test");
}

test("readiness exercises migrated CRM and auth tables without returning records", async () => {
  configure();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ready" });
  expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
    event: "gravity.health",
    status: "ready",
  });
});

test.each([
  ["relationships", "context_source"],
  ["relationships", "context_details"],
  ["people", "tags"],
  ["companies", "amount_minor"],
  ["relationships", "currency"],
  ["opportunities", "tags"],
  ["invitations", "token_hash"],
])(
  "readiness rejects an incomplete upgrade missing %s.%s",
  async (table, column) => {
    configure();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await local.client.exec(
      `BEGIN; ALTER TABLE "${table}" DROP COLUMN "${column}" CASCADE;`,
    );
    try {
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: "unavailable" });
    } finally {
      await local.client.exec("ROLLBACK;");
    }
  },
);

test("database access without a configured login is unavailable, while email-only login is ready", async () => {
  configure();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  expect((await GET()).status).toBe(503);
  vi.stubEnv("RESEND_API_KEY", "fictional-resend-key");
  expect((await GET()).status).toBe(503);
  vi.stubEnv("EMAIL_FROM", "Gravity <login@example.test>");
  expect((await GET()).status).toBe(200);
});

test("demo identities and missing auth configuration are never production-ready", async () => {
  configure();
  vi.spyOn(console, "error").mockImplementation(() => {});
  demo = true;
  expect((await GET()).status).toBe(503);
  demo = false;
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  expect((await GET()).status).toBe(503);
});

test("database failures do not put secrets or SQL in the response or logs", async () => {
  configure();
  vi.spyOn(local.db, "execute").mockRejectedValue(
    new Error("postgresql://user:secret@database.example SELECT private_key"),
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
  const message = JSON.stringify(log.mock.calls);
  expect(message).not.toContain("secret");
  expect(message).not.toContain("private_key");
  expect(message).not.toContain("postgresql");
});
