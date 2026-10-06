import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { seal } from "../packages/connectors/security";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
vi.mock("@crm/database/client", async (original) => ({
  ...(await original<typeof import("../packages/database/client")>()),
  getDatabase: async () => local.db,
  isDemoMode: () => false,
}));
const configurationId = demoId(980);
const connectionId = demoId(981);
const organizationId = demoId(1);
const secret = "fictional-v1-webhook-bearer-secret";
beforeAll(async () => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  local = await createLocalDatabase();
  await seedDemo(local.db);
  const credentials = {
    apiKey: "fictional-v1-token",
    apiVersion: "v1",
    dsn: "api99.unipile.com:12345",
    signingSecret: secret,
  };
  await local.db.insert(s.providerConfigurations).values({
    id: configurationId,
    organizationId,
    ownerId: demoUser,
    provider: "unipile",
    webhookReady: true,
    encryptedCredentials: seal(
      credentials,
      `${organizationId}:${demoUser}:${configurationId}:provider`,
    ),
  });
  await local.db.insert(s.connections).values({
    id: connectionId,
    organizationId,
    productId: demoId(10),
    ownerId: demoUser,
    provider: "unipile",
    externalAccountId: "account-a",
    providerConfigurationId: configurationId,
    status: "connected",
    encryptedCredentials: seal(
      credentials,
      `${organizationId}:${demoUser}:${connectionId}`,
    ),
  });
});
afterAll(async () => {
  await local.client.close();
  vi.unstubAllEnvs();
});
afterEach(() => vi.restoreAllMocks());
const send = async (payload: unknown, authorization = `Bearer ${secret}`) => {
  const { POST } = await import("../src/app/api/webhooks/unipile/route");
  return POST(
    new Request(
      `https://crm.example.test/api/webhooks/unipile?configurationId=${configurationId}`,
      {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  );
};
const message = {
  event: "message_received",
  account_id: "account-a",
  account_type: "LINKEDIN",
  message_id: "message-a",
  chat_id: "chat-a",
  message: "Fictional incoming message",
  timestamp: "2026-10-01T00:00:00.000Z",
  account_info: { user_id: "owner-provider-id" },
  sender: { attendee_provider_id: "sender-provider-id" },
};
test("V1 webhook authentication rejects missing or incorrect custom headers", async () => {
  expect((await send(message, "")).status).toBe(401);
  expect((await send(message, "Bearer wrong-secret")).status).toBe(401);
  expect(await local.db.select().from(s.integrationReceipts)).toHaveLength(0);
});
test("V1 messages are normalized into durable deduplicated receipts", async () => {
  expect((await send(message)).status).toBe(200);
  expect((await send(message)).status).toBe(200);
  const receipts = await local.db.select().from(s.integrationReceipts);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]?.payload).toMatchObject({
    id: "message-a",
    chat_id: "chat-a",
    text: message.message,
    is_sender: false,
  });
  expect(
    (await send({ ...message, account_id: "another-account" })).status,
  ).toBe(422);
});
test("V1 account status separates provider interruptions from expired LinkedIn authentication", async () => {
  const payload = (status: string) => ({
    AccountStatus: {
      account_id: "account-a",
      account_type: "LINKEDIN",
      message: status,
    },
  });
  expect((await send(payload("ERROR"))).status).toBe(200);
  let [connection] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.id, connectionId));
  expect(connection).toMatchObject({
    status: "connected",
    errorCode: "PROVIDER_UNAVAILABLE",
  });
  expect((await send(payload("PERMISSIONS"))).status).toBe(200);
  [connection] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.id, connectionId));
  expect(connection).toMatchObject({
    status: "connected",
    errorCode: "PROVIDER_PERMISSION",
  });
  expect((await send(payload("CREDENTIALS"))).status).toBe(200);
  [connection] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.id, connectionId));
  expect(connection).toMatchObject({
    status: "reconnect_required",
    errorCode: "RECONNECT_REQUIRED",
  });
  expect((await send(payload("RECONNECTED"))).status).toBe(200);
  [connection] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.id, connectionId));
  expect(connection).toMatchObject({ status: "connected", errorCode: null });
  expect((await send(payload("OK"))).status).toBe(200);
});
test("a V1 receiver accepts authenticated delivery while registration is still completing", async () => {
  await local.db
    .update(s.providerConfigurations)
    .set({ webhookReady: false })
    .where(eq(s.providerConfigurations.id, configurationId));
  expect((await send(message)).status).toBe(200);
  expect((await send(message, "Bearer wrong-secret")).status).toBe(401);
  await local.db
    .update(s.providerConfigurations)
    .set({ webhookReady: true })
    .where(eq(s.providerConfigurations.id, configurationId));
});
