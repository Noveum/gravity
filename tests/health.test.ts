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
