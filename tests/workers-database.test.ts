import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Client = { options: { ssl: unknown } };
const clientOf = (db: unknown) => (db as { $client: Client }).$client;

async function workersRuntime() {
  vi.resetModules();
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://app:secret@database.example.test:5432/gravity",
  );
  return {
    database: await import("../packages/database/client"),
    changes: await import("../packages/core/changes"),
  };
}
beforeEach(() => vi.stubEnv("DATABASE_SSL_MODE", "verify-full"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("each Workers invocation owns its connection behind one stable handle", async () => {
  const { database } = await workersRuntime();
  const { getDatabase, runWithInvocationDatabase } = database;
  const handle = await getDatabase();
  const clients = await Promise.all(
    [1, 2].map((_) =>
      runWithInvocationDatabase(async () => {
        const first = clientOf(await getDatabase());
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(clientOf(handle)).toBe(first);
        return first;
      }),
    ),
  );
  expect(clients[0]).not.toBe(clients[1]);
  expect(await getDatabase()).toBe(handle);
});

test("a Workers query outside an invocation fails instead of sharing a socket", async () => {
  const { database } = await workersRuntime();
  const handle = await database.getDatabase();
  expect(() => clientOf(handle)).toThrow("DATABASE_INVOCATION_REQUIRED");
});

test("only the Hyperdrive hop drops TLS; a direct Workers connection verifies it", async () => {
  const { database } = await workersRuntime();
  const { getDatabase, runWithInvocationDatabase } = database;
  const direct = await runWithInvocationDatabase(async () =>
    clientOf(await getDatabase()),
  );
  expect(direct.options.ssl).toEqual({ rejectUnauthorized: true });
  const pooled = await runWithInvocationDatabase(
    async () => clientOf(await getDatabase()),
    "postgresql://app:secret@pool.hyperdrive.local:5432/gravity",
  );
  expect(pooled.options.ssl).toBe(false);
});

test("a change published by one Workers request never runs another request's listener", async () => {
  const { changes } = await workersRuntime();
  const listener = vi.fn();
  const unsubscribe = changes.subscribeChanges("organization", listener);
  changes.publishChange("organization");
  unsubscribe();
  expect(listener).not.toHaveBeenCalled();
});

test("sign-in limits read the client address only from the header the platform owns", async () => {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "fictional-secret-of-at-least-32-characters",
  );
  const headersOn = async (runtime: "node" | "workers") => {
    if (runtime === "workers") await workersRuntime();
    else vi.resetModules();
    const { createAuthForDatabase } = await import("../packages/auth/server");
    const { getDatabase } = await import("../packages/database/client");
    const database =
      runtime === "workers" ? await getDatabase() : ({} as never);
    return createAuthForDatabase(database).options.advanced?.ipAddress
      ?.ipAddressHeaders;
  };
  expect(await headersOn("workers")).toEqual(["cf-connecting-ip"]);
  vi.unstubAllGlobals();
  expect(await headersOn("node")).toBeUndefined();
});
