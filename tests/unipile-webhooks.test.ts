import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  ProviderConfigurationService,
  unipileCredentials,
} from "../packages/connectors/configuration";
import { IntegrationService } from "../packages/connectors/service";
import { createLocalDatabase } from "../packages/database/client";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const principal = { userId: demoUser, source: "session" as const };
const organizationId = demoId(1);
const credentials = {
  apiVersion: "v1" as const,
  dsn: "api99.unipile.com:12345",
  apiKey: "fictional-v1-token",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(async () => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("APP_URL", "https://crm.example.test");
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterEach(async () => {
  await local.client.close();
  vi.unstubAllEnvs();
});

function provider() {
  const hooks: Record<string, unknown>[] = [];
  let ambiguous = false;
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "DELETE") {
      const index = hooks.findIndex(
        (hook) => hook.id === url.pathname.split("/").at(-1),
      );
      if (index >= 0) hooks.splice(index, 1);
      return json({ object: "WebhookDeleted" });
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const id = `hook-${hooks.length}`;
      hooks.push({
        ...body,
        id,
        account_ids: body.account_ids.map((id: string) => ({ id })),
      });
      if (ambiguous) {
        ambiguous = false;
        return json({}, 500);
      }
      return json({ webhook_id: id }, 201);
    }
    return json({
      items: url.pathname.endsWith("/webhooks") ? hooks : [],
      cursor: null,
    });
  });
  return {
    hooks,
    transport,
    failAfterCreate: () => {
      ambiguous = true;
    },
  };
}
async function setup(transport: typeof fetch) {
  const settings = new ProviderConfigurationService(local.db, transport);
  const configuration = await settings.configure(principal, {
    organizationId,
    ...credentials,
  });
  const connection = await new IntegrationService(local.db).saveConnected(
    principal,
    organizationId,
    demoId(10),
    "linkedin",
    "fictional-account",
    "Fictional owner",
    credentials,
    [],
    undefined,
    undefined,
    configuration.id,
  );
  return { settings, configuration, connection };
}

test("automatic V1 webhooks are account scoped, encrypted and reused on retry", async () => {
  const mock = provider();
  const { settings, connection } = await setup(mock.transport);
  const result = await settings.registerWebhooks(
    principal,
    organizationId,
    connection.id,
  );
  expect(result.webhookReady).toBe(true);
  expect(mock.hooks).toHaveLength(2);
  for (const hook of mock.hooks)
    expect(hook).toMatchObject({
      enabled: true,
      format: "json",
      account_ids: [{ id: "fictional-account" }],
    });
  const row = await settings.own(principal, organizationId);
  if (!row) throw new Error("CONFIGURATION_MISSING");
  const stored = unipileCredentials(row);
  expect(Object.keys(stored.webhooks ?? {})).toEqual(["fictional-account"]);
  expect(stored.signingSecret).toHaveLength(64);
  expect(JSON.stringify(result)).not.toContain(stored.signingSecret);
  expect(row.encryptedCredentials).not.toContain(stored.signingSecret);
  await settings.registerWebhooks(principal, organizationId, connection.id);
  expect(
    mock.transport.mock.calls.filter((call) => call[1]?.method === "POST"),
  ).toHaveLength(2);
  expect(await settings.remove(principal, organizationId, row.id)).toEqual({
    ok: true,
    webhookCleanupPending: false,
  });
  expect(mock.hooks).toHaveLength(0);
});

test("a lost create response is reconciled from the provider before retrying", async () => {
  const mock = provider();
  const { settings, connection } = await setup(mock.transport);
  mock.failAfterCreate();
  await expect(
    settings.registerWebhooks(principal, organizationId, connection.id),
  ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  const row = await settings.own(principal, organizationId);
  if (!row) throw new Error("CONFIGURATION_MISSING");
  expect(row.webhookReady).toBe(false);
  expect(unipileCredentials(row).webhookRegistration).toBeUndefined();
  await expect(
    settings.configure(principal, {
      organizationId,
      configurationId: row.id,
      signingSecret: "fictional-token-replacement",
    }),
  ).rejects.toMatchObject({ code: "UNIPILE_WEBHOOK_MANAGED" });
  await settings.registerWebhooks(principal, organizationId, connection.id);
  expect(mock.hooks).toHaveLength(2);
  expect(
    mock.transport.mock.calls.filter((call) => call[1]?.method === "POST"),
  ).toHaveLength(2);
});

test("registration refuses other owners and restricted MCP grants before provider calls", async () => {
  const mock = provider();
  const { settings, connection } = await setup(mock.transport);
  mock.transport.mockClear();
  await expect(
    settings.registerWebhooks(
      { userId: "demo-teammate", source: "session" },
      organizationId,
      connection.id,
    ),
  ).rejects.toMatchObject({ code: "UNIPILE_SETUP_REQUIRED" });
  await expect(
    settings.registerWebhooks(
      { ...principal, source: "mcp", organizationId, productIds: [demoId(10)] },
      organizationId,
      connection.id,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    settings.accounts(
      { ...principal, source: "mcp", organizationId, productIds: [demoId(10)] },
      organizationId,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mock.transport).not.toHaveBeenCalled();
});

test("removal discovers a hook created before a lost receipt without deleting unrelated hooks", async () => {
  const mock = provider();
  const { settings, connection, configuration } = await setup(mock.transport);
  mock.failAfterCreate();
  await expect(
    settings.registerWebhooks(principal, organizationId, connection.id),
  ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  mock.hooks.push({
    ...mock.hooks[0],
    id: "unrelated",
    name: "Another integration",
  });
  expect(
    await settings.remove(principal, organizationId, configuration.id),
  ).toEqual({ ok: true, webhookCleanupPending: false });
  expect(mock.hooks).toHaveLength(1);
  expect(mock.hooks[0]?.name).toBe("Another integration");
});

test("concurrent registration and setup removal do not create competing webhook tokens", async () => {
  const mock = provider();
  const { settings, connection, configuration } = await setup(mock.transport);
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  mock.transport.mockImplementationOnce(async () => {
    started();
    await blocked;
    return json({ items: [], cursor: null });
  });
  const first = settings.registerWebhooks(
    principal,
    organizationId,
    connection.id,
  );
  await entered;
  await expect(
    settings.registerWebhooks(principal, organizationId, connection.id),
  ).rejects.toMatchObject({ code: "UNIPILE_WEBHOOK_BUSY" });
  await expect(
    settings.remove(principal, organizationId, configuration.id),
  ).rejects.toMatchObject({ code: "UNIPILE_WEBHOOK_BUSY" });
  release();
  await first;
  expect(mock.hooks).toHaveLength(2);
});
