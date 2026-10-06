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
import {
  dispatchMessage,
  resolveLinkedInRecipient,
} from "../packages/connectors/outbound-provider";
import { readProviderPage } from "../packages/connectors/providers";
import { IntegrationService } from "../packages/connectors/service";
import { unipileDsn } from "../packages/connectors/unipile-v1";
import { createLocalDatabase } from "../packages/database/client";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const principal = { userId: demoUser, source: "session" as const };
const organizationId = demoId(1);
const apiKey = "fictional-v1-access-token";
const dsn = "api99.unipile.com:12345";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => local.client.close());
beforeEach(() => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
});
afterEach(() => vi.unstubAllEnvs());

test("V1 dispatch verifies the chat belongs to the selected account before submitting multipart data", async () => {
  const transport = vi.fn<typeof fetch>(async (_input, init) =>
    init?.method === "POST"
      ? json({ message_id: "sent-a" }, 201)
      : json({ id: "chat-a", account_id: "account-a" }),
  );
  const credentials = { apiKey, apiVersion: "v1" as const, dsn };
  const message = {
    channel: "linkedin" as const,
    accountId: "account-a",
    from: "",
    recipient: "provider-a",
    subject: "",
    body: "Fictional reply",
    threadId: "chat-a",
    messageId: "stable-local-id",
  };
  expect(await dispatchMessage(message, credentials, transport)).toEqual({
    externalMessageId: "sent-a",
    externalThreadId: "chat-a",
  });
  const call = transport.mock.calls.at(-1);
  expect(new URL(String(call?.[0])).pathname).toBe(
    "/api/v1/chats/chat-a/messages",
  );
  expect(call?.[1]?.body).toBeInstanceOf(FormData);
  const body = call?.[1]?.body as FormData;
  expect(body.get("text")).toBe(message.body);
  expect(new Headers(call?.[1]?.headers).get("content-type")).toBeNull();
  const wrongAccount = vi.fn<typeof fetch>(async () =>
    json({ id: "chat-a", account_id: "account-b" }),
  );
  await expect(
    dispatchMessage(message, credentials, wrongAccount),
  ).rejects.toMatchObject({
    code: "RECIPIENT_MISMATCH",
    dispatchNotAttempted: true,
  });
  expect(wrongAccount).toHaveBeenCalledOnce();
});

test("V1 recipient lookup uses its account query and returns the provider ID", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    json({ provider_id: "provider-a", public_identifier: "fictional-owner" }),
  );
  const credentials = { apiKey, apiVersion: "v1" as const, dsn };
  expect(
    await resolveLinkedInRecipient(
      "account-a",
      "https://www.linkedin.com/in/fictional-owner",
      credentials,
      transport,
    ),
  ).toBe("provider-a");
  const url = new URL(String(transport.mock.calls[0]?.[0]));
  expect(url.searchParams.get("account_id")).toBe("account-a");
  expect(url.pathname).toBe("/api/v1/users/fictional-owner");
});

test("a V1 token is verified on its DSN and persists the version without a V2 webhook", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    json({ items: [], cursor: null }),
  );
  const service = new ProviderConfigurationService(local.db, transport);
  const input = { organizationId, apiKey, apiVersion: "v1" as const, dsn };
  const saved = await service.configure(principal, input);
  expect(saved).toMatchObject({ apiVersion: "v1", dsn, webhookReady: false });
  const request = new URL(String(transport.mock.calls[0]?.[0]));
  expect(request.origin).toBe("https://api99.unipile.com");
  expect(request.pathname).toBe("/api/v1/accounts");
  expect(request.searchParams.get("port")).toBe("12345");
  expect(
    new Headers(transport.mock.calls[0]?.[1]?.headers).get("X-API-KEY"),
  ).toBe(apiKey);
  const row = await service.own(principal, organizationId);
  if (!row) throw new Error("MISSING_CONFIGURATION");
  expect(unipileCredentials(row)).toMatchObject({
    apiKey,
    apiVersion: "v1",
    dsn,
  });
  expect(
    (
      await new IntegrationService(local.db).overview(principal, {
        organizationId,
      })
    ).configured.linkedin,
  ).toBe(true);
});

test("verification rejects invalid keys with a setup error rather than requesting LinkedIn reconnection", async () => {
  const service = new ProviderConfigurationService(local.db, async () =>
    json({ secret: apiKey }, 401),
  );
  await expect(
    service.configure(principal, { organizationId: demoId(2), apiKey }),
  ).rejects.toMatchObject({ code: "UNIPILE_KEY_INVALID" });
  expect(await service.own(principal, demoId(2))).toBeNull();
});

test("V1 sync resumes its message cursor and accepts numeric flags and null message text", async () => {
  const transport = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats")
      return json({
        items: [{ id: "chat-a", account_id: "account-a" }],
        cursor: "next-chats",
      });
    return json({
      items: [
        {
          id: "message-a",
          account_id: "account-a",
          chat_id: "chat-a",
          text: null,
          timestamp: "2026-10-01T00:00:00.000Z",
          is_sender: 0,
          is_event: 0,
        },
      ],
      cursor: "next-messages",
    });
  });
  const credentials = { apiKey, apiVersion: "v1" as const, dsn };
  const first = await readProviderPage(
    "linkedin",
    credentials,
    "account-a",
    "",
    {},
    transport,
  );
  expect(first.records).toMatchObject([
    { externalId: "chat-a:message-a", body: "", direction: "inbound" },
  ]);
  expect(first.more).toBe(true);
  const second = await readProviderPage(
    "linkedin",
    credentials,
    "account-a",
    "",
    first.cursor,
    transport,
  );
  expect(second.records).toHaveLength(1);
  expect(transport).toHaveBeenCalledTimes(3);
  const last = new URL(String(transport.mock.calls.at(-1)?.[0]));
  expect(last.searchParams.get("cursor")).toBe("next-messages");
  expect(last.pathname).toBe("/api/v1/chats/chat-a/messages");
});

test("a DSN cannot forward the private token outside Unipile", () => {
  for (const value of [
    "api99.unipile.com.evil.test:12345",
    "localhost:12345",
    "http://api99.unipile.com:12345",
    "api99.unipile.com:12345/path",
    "api99.unipile.com:0",
    "api99.unipile.com:65536",
    "api99.unipile.com:12345?port=443",
  ])
    expect(unipileDsn.safeParse(value).success).toBe(false);
  expect(unipileDsn.parse(`https://${dsn}/`)).toBe(dsn);
});

test("an existing V1 account is bound only after authoritative account verification", async () => {
  const account = {
    id: "fictional-account-a",
    type: "LINKEDIN",
    name: "Fictional owner",
    sources: [{ id: "fictional-account-a_MESSAGING", status: "OK" }],
  };
  const transport = vi.fn<typeof fetch>(async (input) =>
    new URL(String(input)).pathname.endsWith("/accounts/fictional-account-a")
      ? json(account)
      : json({ items: [account], cursor: null }),
  );
  const settings = new ProviderConfigurationService(local.db, transport);
  expect(await settings.accounts(principal, organizationId)).toEqual({
    accounts: [{ id: account.id, name: account.name, status: "OK" }],
    nextCursor: null,
  });
  const service = new IntegrationService(local.db, transport);
  const input = {
    organizationId,
    productId: demoId(10),
    provider: "linkedin" as const,
    accountId: account.id,
  };
  const result = await service.connect(principal, input);
  const overview = await service.overview(principal, { organizationId });
  expect(
    overview.connections.find((row) => row.id === result.connectionId)
      ?.displayName,
  ).toBe(account.name);
  await expect(
    settings.accounts(
      { userId: "demo-teammate", source: "session" },
      organizationId,
    ),
  ).rejects.toMatchObject({ code: "UNIPILE_SETUP_REQUIRED" });
  const mismatch = new IntegrationService(local.db, async () =>
    json({ ...account, id: "different-account" }),
  );
  await expect(mismatch.connect(principal, input)).rejects.toMatchObject({
    code: "PROVIDER_RESPONSE_INVALID",
  });
  for (const [status, code] of [
    ["CREDENTIALS", "RECONNECT_REQUIRED"],
    ["PERMISSIONS", "PROVIDER_PERMISSION"],
    ["ERROR", "PROVIDER_UNAVAILABLE"],
  ]) {
    const unavailable = new IntegrationService(local.db, async () =>
      json({
        ...account,
        sources: [{ id: `${account.id}_MESSAGING`, status }],
      }),
    );
    await expect(unavailable.connect(principal, input)).rejects.toMatchObject({
      code,
    });
  }
});
