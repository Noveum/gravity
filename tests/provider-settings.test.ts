import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import {
  ProviderConfigurationService,
  unipileCredentials,
} from "../packages/connectors/configuration";
import { ingestReply } from "../packages/connectors/replies";
import { unseal } from "../packages/connectors/security";
import { IntegrationService } from "../packages/connectors/service";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const admin: Principal = { userId: demoUser, source: "session" };
const member: Principal = { userId: "demo-teammate", source: "session" };
const organizationId = demoId(1);
const scope = { organizationId, productId: demoId(10) };
const key = "fictional-personal-unipile-key";
const signingSecret = "fictional-private-webhook-secret";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const transport = vi.fn<typeof fetch>(async (url) =>
  String(url).includes("/auth/link")
    ? json({ link: "https://auth.unipile.com/fictional-auth" })
    : json({ data: [] }),
);
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => local.client.close());
beforeEach(() => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("APP_URL", "https://crm.example.test");
  vi.stubEnv("UNIPILE_API_KEY", "global-key-must-not-be-used");
  vi.stubEnv("UNIPILE_WEBHOOK_SECRET", "global-secret-must-not-be-used");
  transport.mockClear();
});
afterEach(() => vi.unstubAllEnvs());
async function setup(principal = admin, org = organizationId, apiKey = key) {
  const service = new ProviderConfigurationService(local.db, transport);
  const existing = await service.own(principal, org);
  if (existing) await service.remove(principal, org, existing.id);
  const first = await service.configure(principal, {
    organizationId: org,
    apiKey,
  });
  const ready = await service.configure(principal, {
    organizationId: org,
    configurationId: first.id,
    signingSecret,
  });
  return { service, ready };
}
async function connect(
  principal: Principal,
  configurationId: string,
  accountId: string,
) {
  const service = new IntegrationService(local.db, transport);
  await service.connect(principal, { ...scope, provider: "linkedin" });
  const { state } = JSON.parse(String(transport.mock.calls.at(-1)?.[1]?.body));
  const account = {
    id: accountId,
    provider: "linkedin",
    name: "Fictional account",
    status: "running",
  };
  const connection = await service.linkedInAccount(
    state,
    account,
    configurationId,
  );
  return { connection, service, state, account };
}

test("a global deployment key never configures a user's LinkedIn access", async () => {
  const service = new IntegrationService(local.db, transport);
  expect((await service.overview(member, scope)).configured.linkedin).toBe(
    false,
  );
  await expect(
    service.connect(member, { ...scope, provider: "linkedin" }),
  ).rejects.toMatchObject({ code: "UNIPILE_SETUP_REQUIRED" });
  expect(transport).not.toHaveBeenCalled();
});

test("a user can verify their key, then save a private encrypted webhook setup without exposing secrets", async () => {
  const settings = new ProviderConfigurationService(local.db, transport);
  const first = await settings.configure(admin, {
    organizationId,
    apiKey: key,
  });
  expect(first.webhookReady).toBe(false);
  expect(first.webhookUrl).toBe(
    `https://crm.example.test/api/webhooks/unipile?configurationId=${first.id}`,
  );
  expect(transport.mock.calls[0][0]).toBe(
    "https://api.unipile.com/v2/accounts?limit=1",
  );
  expect(
    new Headers(transport.mock.calls[0][1]?.headers).get("X-API-KEY"),
  ).toBe(key);
  const second = await settings.configure(admin, {
    organizationId,
    configurationId: first.id,
    signingSecret,
  });
  expect(second.webhookReady).toBe(true);
  const stored = await settings.own(admin, organizationId);
  if (!stored?.encryptedCredentials) throw new Error("CREDENTIALS_MISSING");
  expect(stored.encryptedCredentials).not.toContain(key);
  expect(stored?.encryptedCredentials).not.toContain(signingSecret);
  expect(unipileCredentials(stored).apiKey).toBe(key);
  expect(() =>
    unseal(
      stored.encryptedCredentials ?? "",
      `${organizationId}:${member.userId}:${first.id}:provider`,
    ),
  ).toThrow();
  const overview = await new IntegrationService(local.db).overview(
    admin,
    scope,
  );
  expect(overview.configured.linkedin).toBe(true);
  expect(JSON.stringify({ first, second, overview })).not.toMatch(
    /fictional-personal-unipile-key|fictional-private-webhook-secret|encryptedCredentials/,
  );
  expect(await settings.own(member, organizationId)).toBeNull();
  await expect(
    settings.remove(member, organizationId, first.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("forbidden organizations and MCP identities cannot configure, read, or remove provider settings", async () => {
  const service = new ProviderConfigurationService(local.db, transport);
  await expect(
    service.configure(member, { organizationId: demoId(2), apiKey: key }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const machine = { ...admin, source: "mcp" as const };
  await expect(service.own(machine, organizationId)).rejects.toMatchObject({
    code: "HUMAN_ACTION_REQUIRED",
  });
  await expect(
    service.configure(machine, { organizationId, apiKey: key }),
  ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
  await expect(
    service.remove(machine, organizationId, randomUUID()),
  ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
  expect(transport).not.toHaveBeenCalled();
});

test("provider rejection does not persist a key or return its error payload", async () => {
  const denied = vi.fn<typeof fetch>(async () => json({ secret: key }, 401));
  const service = new ProviderConfigurationService(local.db, denied);
  await expect(
    service.configure(admin, { organizationId: demoId(2), apiKey: key }),
  ).rejects.toMatchObject({ code: "UNIPILE_KEY_INVALID" });
  expect(await service.own(admin, demoId(2))).toBeNull();
});

test("another member and organization use their own settings and hosted-auth key", async () => {
  const a = await setup(admin);
  const b = await setup(member, organizationId, "fictional-member-unipile-key");
  const c = await setup(admin, demoId(2), "fictional-other-org-unipile-key");
  expect(new Set([a.ready.id, b.ready.id, c.ready.id]).size).toBe(3);
  await new IntegrationService(local.db, transport).connect(member, {
    ...scope,
    provider: "linkedin",
  });
  expect(
    new Headers(transport.mock.calls.at(-1)?.[1]?.headers).get("X-API-KEY"),
  ).toBe("fictional-member-unipile-key");
  expect(await a.service.own(admin, organizationId)).toMatchObject({
    id: a.ready.id,
  });
});

test("identical external account IDs are isolated by setup and reply ingestion refuses an ambiguous lookup", async () => {
  const a = await setup(admin);
  const b = await setup(member, organizationId, "fictional-member-unipile-key");
  const first = await connect(admin, a.ready.id, "same-provider-account-id");
  const second = await connect(member, b.ready.id, "same-provider-account-id");
  expect(first.connection.id).not.toBe(second.connection.id);
  const reply = {
    provider: "unipile" as const,
    accountId: "same-provider-account-id",
    messageId: "same-message-id",
    threadId: "new-private-thread",
    direction: "inbound" as const,
    channel: "linkedin" as const,
    body: "Fictional message",
    occurredAt: new Date().toISOString(),
  };
  await expect(ingestReply(local.db, reply)).rejects.toMatchObject({
    code: "CONNECTION_UNAVAILABLE",
  });
  await ingestReply(local.db, { ...reply, connectionId: first.connection.id });
  const receipts = await local.db
    .select()
    .from(s.connectorEvents)
    .where(eq(s.connectorEvents.providerEventId, reply.messageId));
  expect(receipts).toHaveLength(1);
  expect(receipts[0].connectionId).toBe(first.connection.id);
  const credentials = unseal<{ apiKey: string }>(
    second.connection.encryptedCredentials ?? "",
    `${organizationId}:${member.userId}:${second.connection.id}`,
  );
  expect(credentials.apiKey).toBe("fictional-member-unipile-key");
  await expect(
    first.service.linkedInAccount(second.state, second.account, a.ready.id),
  ).rejects.toMatchObject({ code: "CONNECTION_FLOW_EXPIRED" });
});

test("removing a setup clears account credentials and leases, expires pending flows, and prevents callback revival", async () => {
  const { service: settings, ready } = await setup(admin);
  const linked = await connect(admin, ready.id, "remove-personal-account");
  await linked.service.connect(admin, { ...scope, provider: "linkedin" });
  const pendingState = JSON.parse(
    String(transport.mock.calls.at(-1)?.[1]?.body),
  ).state;
  await local.db
    .update(s.connections)
    .set({ leaseId: randomUUID(), leaseUntil: new Date(Date.now() + 60000) })
    .where(eq(s.connections.id, linked.connection.id));
  await settings.remove(admin, organizationId, ready.id);
  expect(await settings.own(admin, organizationId)).toBeNull();
  const [removed] = await local.db
    .select()
    .from(s.providerConfigurations)
    .where(eq(s.providerConfigurations.id, ready.id));
  expect(removed).toMatchObject({
    active: false,
    encryptedCredentials: null,
    webhookReady: false,
  });
  const [account] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.id, linked.connection.id));
  expect(account).toMatchObject({
    status: "disconnected",
    encryptedCredentials: null,
    leaseId: null,
    leaseUntil: null,
  });
  await expect(
    linked.service.linkedInAccount(linked.state, linked.account, ready.id),
  ).rejects.toMatchObject({ code: "CONNECTION_FLOW_EXPIRED" });
  await expect(
    linked.service.linkedInAccount(pendingState, linked.account, ready.id),
  ).rejects.toMatchObject({ code: "CONNECTION_FLOW_EXPIRED" });
  const replacement = await settings.configure(admin, {
    organizationId,
    apiKey: key,
  });
  expect(replacement.id).not.toBe(ready.id);
});

test("connected setups require explicit removal before credential replacement", async () => {
  const { service: settings, ready } = await setup(admin);
  await connect(admin, ready.id, "replacement-protected-account");
  await expect(
    settings.configure(admin, {
      organizationId,
      configurationId: ready.id,
      signingSecret: "replacement-fictional-secret",
    }),
  ).rejects.toMatchObject({ code: "PROVIDER_CONFIGURATION_IN_USE" });
  const current = await settings.own(admin, organizationId);
  if (!current) throw new Error("CONFIGURATION_MISSING");
  expect(unipileCredentials(current).signingSecret).toBe(signingSecret);
  const rows = await local.db
    .select()
    .from(s.providerConfigurations)
    .where(
      and(
        eq(s.providerConfigurations.organizationId, organizationId),
        eq(s.providerConfigurations.ownerId, admin.userId),
        eq(s.providerConfigurations.active, true),
      ),
    );
  expect(rows).toHaveLength(1);
});

test("changing a key before connecting resets its webhook and expires pending authentication", async () => {
  const { service: settings, ready } = await setup(member);
  const service = new IntegrationService(local.db, transport);
  await service.connect(member, { ...scope, provider: "linkedin" });
  const { state } = JSON.parse(String(transport.mock.calls.at(-1)?.[1]?.body));
  const updated = await settings.configure(member, {
    organizationId,
    configurationId: ready.id,
    apiKey: "fictional-new-application-key",
  });
  expect(updated.webhookReady).toBe(false);
  const current = await settings.own(member, organizationId);
  if (!current) throw new Error("CONFIGURATION_MISSING");
  expect(unipileCredentials(current).signingSecret).toBeUndefined();
  await expect(service.flow(state)).rejects.toMatchObject({
    code: "CONNECTION_FLOW_EXPIRED",
  });
});
