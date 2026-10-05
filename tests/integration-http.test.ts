import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import type { Principal } from "../packages/core/policy";
import { DomainError } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let principal: Principal | null = { userId: demoUser, source: "session" };
vi.mock("@crm/database/client", async (original) => ({
  ...(await original<typeof import("../packages/database/client")>()),
  getDatabase: async () => local.db,
  isDemoMode: () => false,
}));
vi.mock("@crm/auth/server", async (original) => ({
  ...(await original<typeof import("../packages/auth/server")>()),
  currentPrincipal: async () => {
    if (!principal) throw new DomainError("UNAUTHORIZED", 401);
    return principal;
  },
}));
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => local.client.close());
afterEach(() => {
  vi.unstubAllEnvs();
  principal = { userId: demoUser, source: "session" };
});
test("integration HTTP reads require a human session and isolate organization scope", async () => {
  const { GET } = await import("../src/app/api/integrations/route");
  const query = `https://crm.example.test/api/integrations?organizationId=${demoId(1)}`;
  principal = null;
  expect((await GET(new Request(query))).status).toBe(401);
  principal = { userId: demoUser, source: "mcp", readOnly: true };
  expect((await GET(new Request(query))).status).toBe(403);
  principal = { userId: demoUser, source: "session" };
  const ok = await GET(new Request(query));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("cache-control")).toContain("no-store");
  expect(
    (
      await GET(
        new Request(
          `https://crm.example.test/api/integrations?organizationId=${demoId(999)}`,
        ),
      )
    ).status,
  ).toBe(403);
});
test("integration mutations reject cross-site requests and malformed operations before any provider call", async () => {
  vi.stubEnv("APP_URL", "https://crm.example.test");
  const { POST } = await import("../src/app/api/integrations/route");
  const send = (origin: string, body: string) =>
    POST(
      new Request("https://crm.example.test/api/integrations", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body,
      }),
    );
  expect(
    (
      await send(
        "https://evil.example.test",
        JSON.stringify({
          operation: "connect",
          organizationId: demoId(1),
          productId: demoId(10),
          provider: "gmail",
        }),
      )
    ).status,
  ).toBe(403);
  expect((await send("https://crm.example.test", "{")).status).toBe(400);
  expect(
    (
      await send(
        "https://crm.example.test",
        JSON.stringify({ operation: "send-all-mail" }),
      )
    ).status,
  ).toBe(400);
});
test("cron fails closed without its Bearer secret and exposes only aggregate results when authorized", async () => {
  vi.stubEnv("CRON_SECRET", "fictional-strong-scheduler-key");
  const { GET } = await import("../src/app/api/integrations/cron/route");
  expect(
    (await GET(new Request("https://crm.example.test/api/integrations/cron")))
      .status,
  ).toBe(401);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const response = await GET(
    new Request("https://crm.example.test/api/integrations/cron", {
      headers: { authorization: "Bearer fictional-strong-scheduler-key" },
    }),
  );
  expect(await response.json()).toEqual({
    synced: 0,
    failed: 0,
    receipts: { processed: 0, failed: 0 },
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "fictional-strong-scheduler-key",
  );
  log.mockRestore();
});
