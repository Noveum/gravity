import { createHmac, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  normalizeCalendar,
  normalizeGmail,
  normalizeLinkedIn,
  providerJson,
  readProviderPage,
} from "../packages/connectors/providers";
import {
  seal,
  unseal,
  verifyFirefliesSignature,
} from "../packages/connectors/security";
import { IntegrationService } from "../packages/connectors/service";
import {
  type ImportRecord,
  importRecordSchema,
} from "../packages/connectors/types";
import { CrmService } from "../packages/core/crm";
import { OutreachService } from "../packages/core/outreach";
import type { Principal } from "../packages/core/policy";
import { RecordService } from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const admin: Principal = { userId: demoUser, source: "session" };
const another: Principal = { userId: "demo-teammate", source: "session" };
const scope = { organizationId: demoId(1), productId: demoId(10) };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  await local.db.insert(s.providerConfigurations).values({
    id: demoId(980),
    organizationId: scope.organizationId,
    ownerId: demoUser,
    provider: "unipile",
    webhookReady: true,
    encryptedCredentials: seal(
      {
        apiKey: "owner-unipile-key",
        signingSecret: "fictional-signing-secret",
      },
      `${scope.organizationId}:${demoUser}:${demoId(980)}:provider`,
    ),
  });
  vi.unstubAllEnvs();
});
afterAll(async () => local.client.close());
beforeEach(() => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "server-client-secret");
  vi.stubEnv("APP_URL", "https://crm.example.test");
  vi.stubEnv("UNIPILE_API_KEY", "server-unipile-key");
  vi.stubEnv("UNIPILE_WEBHOOK_SECRET", "webhook-secret");
});
afterEach(() => vi.unstubAllEnvs());
const authTransport = vi.fn<typeof fetch>(async (url) =>
  String(url).includes("/token")
    ? json({
        access_token: "fake-access-credential",
        refresh_token: "fake-refresh-credential",
        expires_in: 3600,
        scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
      })
    : json({
        sub: "integration-google-user",
        email: "owner@example.test",
        email_verified: true,
      }),
);

test("credentials are authenticated, encrypted and bound to the organization, owner and row", () => {
  const stored = seal({ refreshToken: "private-refresh" }, "org:owner:row");
  expect(stored).not.toContain("private-refresh");
  expect(unseal(stored, "org:owner:row")).toEqual({
    refreshToken: "private-refresh",
  });
  expect(() => unseal(stored, "another:owner:row")).toThrow(
    "CONNECTION_UNAVAILABLE",
  );
  expect(() => unseal(`${stored.slice(0, -2)}xx`, "org:owner:row")).toThrow(
    "CONNECTION_UNAVAILABLE",
  );
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "");
  expect(() => seal("key", "row")).toThrow("CONNECTOR_NOT_CONFIGURED");
});

test("Google connects with scoped read-only consent, session binding, PKCE and one-time state", async () => {
  const service = new IntegrationService(local.db, authTransport);
  const result = await service.connect(admin, {
    ...scope,
    provider: "gmail",
    allowSending: false,
  });
  const url = new URL(result.url ?? "");
  const state = url.searchParams.get("state") ?? "";
  expect(url.hostname).toBe("accounts.google.com");
  expect(url.searchParams.get("access_type")).toBe("offline");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("scope")).not.toContain("gmail.send");
  expect(url.searchParams.get("scope")).not.toContain("calendar");
  await expect(
    service.googleCallback(another, state, "code"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await service.googleCallback(admin, state, "code");
  await expect(
    service.googleCallback(admin, state, "code"),
  ).rejects.toMatchObject({ code: "CONNECTION_FLOW_EXPIRED" });
  const overview = await service.overview(admin, scope);
  expect(
    overview.connections.some(
      (c) => c.provider === "gmail" && c.status === "connected",
    ),
  ).toBe(true);
  expect(JSON.stringify(overview)).not.toMatch(
    /fake-access-credential|fake-refresh-credential|encryptedCredentials/,
  );
  const other = await service.overview(another, scope);
  expect(other.connections).toEqual([]);
  await expect(
    service.overview(another, { organizationId: demoId(2) }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    service.connect(
      { ...admin, source: "mcp", readOnly: true },
      { ...scope, provider: "gmail" },
    ),
  ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
});

test("missing mailbox scope cannot silently turn a Google login into a mailbox connection", async () => {
  const transport = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("/token")
      ? json({
          access_token: "a",
          refresh_token: "r",
          expires_in: 3600,
          scope: "openid email",
        })
      : json({
          sub: "no-scope",
          email: "owner@example.test",
          email_verified: true,
        }),
  );
  const service = new IntegrationService(local.db, transport);
  const result = await service.connect(admin, {
    ...scope,
    provider: "calendar",
  });
  const state = new URL(result.url ?? "").searchParams.get("state") ?? "";
  await expect(
    service.googleCallback(admin, state, "code"),
  ).rejects.toMatchObject({ code: "PROVIDER_PERMISSION" });
  expect(
    await local.db
      .select()
      .from(s.connections)
      .where(eq(s.connections.externalAccountId, "no-scope")),
  ).toEqual([]);
});

test("LinkedIn redirect cannot claim an account; only a matching signed webhook flow creates the binding", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    json({ link: "https://auth.unipile.com/temporary-link" }),
  );
  const service = new IntegrationService(local.db, transport);
  await service.connect(admin, { ...scope, provider: "linkedin" });
  const request = JSON.parse(String(transport.mock.calls[0][1]?.body));
  expect(request.providers).toEqual(["linkedin"]);
  expect(request.account_id).toBeUndefined();
  const callback = await service.linkedInCallback(admin, request.state);
  expect(callback.pending).toBe(true);
  await expect(
    service.linkedInCallback(another, request.state),
  ).rejects.toThrow();
  const connected = await service.linkedInAccount(
    request.state,
    {
      id: "acc_test_linkedin",
      name: "Test account",
      provider: "linkedin",
      status: "running",
    },
    demoId(980),
  );
  expect(connected.ownerId).toBe(demoUser);
  expect((await service.linkedInCallback(admin, request.state)).pending).toBe(
    false,
  );
  await expect(
    service.linkedInAccount(
      request.state,
      {
        id: "acc_another",
        name: "Another",
        provider: "linkedin",
        status: "running",
      },
      demoId(980),
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_FLOW_EXPIRED" });
  await expect(
    service.own(another, scope.organizationId, connected.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("Fireflies verifies the API owner, encrypts credentials and offers a per-connection signed webhook", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    json({
      data: {
        user: {
          user_id: "fireflies-test-user",
          email: "notes@example.test",
          name: "Notes owner",
        },
      },
    }),
  );
  const service = new IntegrationService(local.db, transport);
  const result = await service.connect(admin, {
    ...scope,
    provider: "fireflies",
    apiKey: "private-fireflies-api-key",
  });
  expect(result.webhookUrl).toContain("/api/webhooks/fireflies?connectionId=");
  expect(result.signingSecret).toHaveLength(64);
  const [row] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.id, result.connectionId ?? ""));
  expect(row.encryptedCredentials).not.toContain("private-fireflies-api-key");
  expect(JSON.stringify(await service.overview(admin, scope))).not.toContain(
    result.signingSecret,
  );
  const raw = Buffer.from(
    JSON.stringify({
      event: "meeting.summarized",
      timestamp: Date.now(),
      meeting_id: "test-meeting",
    }),
  );
  const signature = `sha256=${createHmac("sha256", result.signingSecret ?? "")
    .update(raw)
    .digest("hex")}`;
  expect(
    verifyFirefliesSignature(raw, signature, result.signingSecret ?? ""),
  ).toBe(true);
  expect(
    verifyFirefliesSignature(
      Buffer.from("{}"),
      signature,
      result.signingSecret ?? "",
    ),
  ).toBe(false);
});

test("review links a whole private thread, routes subsequent replies, and exposes no content to another member", async () => {
  const service = new IntegrationService(local.db, authTransport);
  const [connection] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.externalAccountId, "integration-google-user"));
  connection.syncCursor = { connectedAt: "2026-10-01T00:00:00.000Z" };
  await local.db
    .update(s.connections)
    .set({ syncCursor: connection.syncCursor })
    .where(eq(s.connections.id, connection.id));
  const record: ImportRecord = {
    externalId: "thread-message-1",
    threadId: "review-thread",
    kind: "message",
    title: "Test thread",
    body: "Private review content",
    occurredAt: "2026-10-01T12:00:00.000Z",
    direction: "inbound",
    participants: ["contact@example.test"],
  };
  await service.importRecord(connection, record);
  await service.importRecord(connection, {
    ...record,
    externalId: "thread-message-2",
    direction: "outbound",
    body: "We answered",
    occurredAt: "2026-10-01T13:00:00.000Z",
  });
  const queue = await service.overview(admin, scope);
  const item = queue.items.find(
    (i) => i.record.externalId === record.externalId,
  );
  expect(item).toBeTruthy();
  await expect(
    service.link(another, scope.organizationId, item?.id ?? "", demoId(300)),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const linkingAgent: Principal = {
    ...admin,
    source: "mcp",
    readOnly: false,
    organizationId: scope.organizationId,
    clientId: "verified-link-client",
    grantId: demoId(987),
  };
  await service.link(
    linkingAgent,
    scope.organizationId,
    item?.id ?? "",
    demoId(300),
  );
  const contributions = await local.db
    .select()
    .from(s.contactContributions)
    .where(eq(s.contactContributions.connectionId, connection.id));
  expect(
    contributions.filter((row) =>
      row.sourceRecordId?.startsWith("message:thread-message-"),
    ),
  ).toHaveLength(2);
  expect(
    contributions.find(
      (row) => row.sourceRecordId === "message:thread-message-1",
    ),
  ).toMatchObject({
    actorId: demoUser,
    sourceMemberId: demoUser,
    transport: "mcp",
    clientId: "verified-link-client",
    grantId: demoId(987),
  });
  const crm = new CrmService(local.db);
  const owner = await crm.context(admin, scope.organizationId, demoId(300));
  expect(owner.messages.some((m) => m.body === record.body)).toBe(true);
  const other = await crm.context(another, scope.organizationId, demoId(300));
  expect(other.messages.some((m) => m.body === record.body)).toBe(false);
  const [conversation] = await local.db
    .select()
    .from(s.conversations)
    .where(
      and(
        eq(s.conversations.connectionId, connection.id),
        eq(s.conversations.externalThreadId, "review-thread"),
      ),
    );
  let actions = await local.db
    .select()
    .from(s.actions)
    .where(
      and(
        eq(s.actions.sourceConversationId, conversation.id),
        eq(s.actions.kind, "reply"),
        eq(s.actions.status, "open"),
      ),
    );
  expect(actions).toHaveLength(0);
  await service.importRecord(connection, {
    ...record,
    externalId: "thread-message-3",
    body: "A new reply",
    occurredAt: "2026-10-02T12:00:00.000Z",
  });
  await service.importRecord(connection, {
    ...record,
    externalId: "thread-message-3",
    body: "A new reply",
    occurredAt: "2026-10-02T12:00:00.000Z",
  });
  actions = await local.db
    .select()
    .from(s.actions)
    .where(
      and(
        eq(s.actions.sourceConversationId, conversation.id),
        eq(s.actions.kind, "reply"),
        eq(s.actions.status, "open"),
      ),
    );
  expect(actions).toHaveLength(1);
  const messages = await local.db
    .select()
    .from(s.messages)
    .where(eq(s.messages.conversationId, conversation.id));
  expect(messages).toHaveLength(3);
  expect(
    (await service.overview(admin, scope)).items.some(
      (i) => i.record.threadId === "review-thread",
    ),
  ).toBe(false);
  const approvedReply = await crm.changeAction(admin, {
    organizationId: scope.organizationId,
    actionId: actions[0].id,
    version: actions[0].version,
    command: "approve",
    draft: "A fictional approved reply",
  });
  await service.importRecord(connection, {
    ...record,
    externalId: "thread-message-4",
    body: "Another live reply after review",
    occurredAt: "2026-10-03T12:00:00.000Z",
  });
  const [invalidated] = await local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, approvedReply.id));
  expect(invalidated).toMatchObject({
    status: "blocked",
    approvedHash: null,
    approvedBy: null,
  });
});

test("meeting updates and cancellations modify one CRM record and require an explicit shared-context link", async () => {
  const service = new IntegrationService(local.db);
  const [connection] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.externalAccountId, "fireflies-test-user"));
  const record: ImportRecord = {
    externalId: "note-one",
    kind: "meeting",
    title: "Customer review",
    body: "Notes summary",
    occurredAt: "2026-10-01T15:00:00.000Z",
    participants: ["contact@example.test"],
    proposedCommitment: "Send proposal",
  };
  await service.importRecord(connection, record);
  const [item] = await local.db
    .select()
    .from(s.integrationItems)
    .where(eq(s.integrationItems.externalId, "note-one"));
  expect(item.entityId).toBeNull();
  await service.link(admin, scope.organizationId, item.id, demoId(300));
  const [linked] = await local.db
    .select()
    .from(s.integrationItems)
    .where(eq(s.integrationItems.id, item.id));
  await service.importRecord(connection, {
    ...record,
    body: "Updated notes",
    canceled: true,
  });
  const [meeting] = await local.db
    .select()
    .from(s.meetings)
    .where(eq(s.meetings.id, linked.entityId ?? ""));
  expect(meeting.summary).toBe("Updated notes");
  expect(meeting.status).toBe("canceled");
  expect(meeting.proposedCommitment).toBe("Send proposal");
  await service.importRecord(connection, {
    ...record,
    body: "Updated notes",
    canceled: true,
  });
  const [unchanged] = await local.db
    .select()
    .from(s.meetings)
    .where(eq(s.meetings.id, meeting.id));
  expect(unchanged.version).toBe(meeting.version);
});

test("linking an unmatched message or meeting to an archived person writes nothing", async () => {
  const service = new IntegrationService(local.db, authTransport);
  const records = new RecordService(local.db);
  const [mira] = await local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, demoId(200)));
  const archived = await records.archivePerson(admin, {
    organizationId: scope.organizationId,
    personId: demoId(200),
    version: mira?.version ?? 1,
    archived: true,
  });
  const [gmail] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.externalAccountId, "integration-google-user"));
  const [fireflies] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.externalAccountId, "fireflies-test-user"));
  await service.importRecord(gmail, {
    externalId: "archived-thread-message",
    threadId: "archived-thread",
    kind: "message",
    title: "Archived thread",
    body: "Should not attach",
    occurredAt: "2026-10-03T12:00:00.000Z",
    direction: "inbound",
    participants: ["nobody@example.test"],
  });
  await service.importRecord(fireflies, {
    externalId: "archived-note",
    kind: "meeting",
    title: "Archived review",
    body: "Should not attach",
    occurredAt: "2026-10-03T15:00:00.000Z",
    participants: ["nobody@example.test"],
  });
  const items = await local.db
    .select()
    .from(s.integrationItems)
    .where(
      inArray(s.integrationItems.externalId, [
        "archived-thread-message",
        "archived-note",
      ]),
    );
  expect(items).toHaveLength(2);
  const meetingsBefore = await local.db.select().from(s.meetings);
  for (const item of items)
    await expect(
      service.link(admin, scope.organizationId, item.id, demoId(300)),
    ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
  expect(
    await local.db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.externalThreadId, "archived-thread")),
  ).toHaveLength(0);
  expect(
    await local.db
      .select()
      .from(s.messages)
      .where(eq(s.messages.providerMessageId, "archived-thread-message")),
  ).toHaveLength(0);
  expect(await local.db.select().from(s.meetings)).toHaveLength(
    meetingsBefore.length,
  );
  const after = await local.db
    .select()
    .from(s.integrationItems)
    .where(
      inArray(
        s.integrationItems.id,
        items.map((item) => item.id),
      ),
    );
  expect(after.map((item) => item.status)).toEqual(["unmatched", "unmatched"]);
  expect(after.every((item) => item.relationshipId === null)).toBe(true);
  await records.archivePerson(admin, {
    organizationId: scope.organizationId,
    personId: demoId(200),
    version: archived.version,
    archived: false,
  });
});

test("new mail on an archived person's linked thread is still stored and matched", async () => {
  const service = new IntegrationService(local.db, authTransport);
  const records = new RecordService(local.db);
  const [gmail] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.externalAccountId, "integration-google-user"));
  const message = (externalId: string, occurredAt: string): ImportRecord => ({
    externalId,
    threadId: "kept-thread",
    kind: "message",
    title: "Kept thread",
    body: `Fictional note ${externalId}`,
    occurredAt,
    direction: "inbound",
    participants: ["person0@example.test"],
  });
  await service.importRecord(
    gmail,
    message("kept-thread-1", "2026-10-03T09:00:00.000Z"),
  );
  const [first] = await local.db
    .select()
    .from(s.integrationItems)
    .where(eq(s.integrationItems.externalId, "kept-thread-1"));
  await service.link(admin, scope.organizationId, first.id, demoId(300));
  const [mira] = await local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, demoId(200)));
  const archived = await records.archivePerson(admin, {
    organizationId: scope.organizationId,
    personId: demoId(200),
    version: mira?.version ?? 1,
    archived: true,
  });
  try {
    await expect(
      service.importRecord(
        gmail,
        message("kept-thread-2", "2026-10-04T09:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();
    expect(
      await local.db
        .select()
        .from(s.messages)
        .where(eq(s.messages.providerMessageId, "kept-thread-2")),
    ).toHaveLength(1);
    const [second] = await local.db
      .select()
      .from(s.integrationItems)
      .where(eq(s.integrationItems.externalId, "kept-thread-2"));
    expect(second).toMatchObject({
      status: "matched",
      relationshipId: demoId(300),
    });
  } finally {
    await records.archivePerson(admin, {
      organizationId: scope.organizationId,
      personId: demoId(200),
      version: archived.version,
      archived: false,
    });
  }
});

test("disconnect during provider fetch cancels imports and does not restore credentials", async () => {
  const [connection] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.externalAccountId, "fireflies-test-user"));
  let resolve!: (response: Response) => void;
  const waiting = new Promise<Response>((r) => {
    resolve = r;
  });
  const transport = vi.fn<typeof fetch>(() => waiting);
  const service = new IntegrationService(local.db, transport);
  const sync = service.sync(admin, scope.organizationId, connection.id);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
  await expect(
    service.sync(admin, scope.organizationId, connection.id),
  ).rejects.toMatchObject({ code: "SYNC_IN_PROGRESS" });
  await service.disconnect(admin, scope.organizationId, connection.id);
  resolve(
    json({
      data: {
        transcripts: [
          {
            id: "late-note",
            title: "Late",
            date: 1790859600000,
            participants: [],
            summary: { overview: "Must not import" },
          },
        ],
      },
    }),
  );
  expect(await sync).toEqual({ imported: 0, more: false });
  const [stored] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.id, connection.id));
  expect(stored.encryptedCredentials).toBeNull();
  expect(stored.status).toBe("disconnected");
  expect(
    await local.db
      .select()
      .from(s.integrationItems)
      .where(eq(s.integrationItems.externalId, "late-note")),
  ).toEqual([]);
});

test("an oversized Gmail From header imports the message without a sender hint", () => {
  const sender = `${"a".repeat(329)}@example.test`;
  expect(sender).toHaveLength(342);
  const record = normalizeGmail(
    {
      id: "long-sender",
      threadId: "long-sender-thread",
      internalDate: "1790859600000",
      labelIds: ["INBOX"],
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: sender },
          { name: "To", value: "owner@example.test" },
          { name: "Subject", value: "Fictional long sender" },
        ],
        body: { data: Buffer.from("Hello").toString("base64url") },
      },
    },
    "owner@example.test",
  );
  expect(record).not.toHaveProperty("from");
  expect(importRecordSchema.parse(record)).toMatchObject({
    externalId: "long-sender",
    direction: "inbound",
  });
});

test("provider normalization preserves direction, MIME text, all-day dates and chat-scoped message IDs", () => {
  const record = normalizeGmail(
    {
      id: "mail",
      threadId: "thread",
      internalDate: "1790859600000",
      labelIds: ["SENT"],
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "Owner <owner@example.test>" },
          { name: "To", value: "Customer <contact@example.test>" },
          { name: "Subject", value: "Follow-up" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: { data: Buffer.from("Plain message").toString("base64url") },
          },
        ],
      },
    },
    "owner@example.test",
  );
  expect(record?.direction).toBe("outbound");
  expect(record?.from).toBe("owner@example.test");
  expect(record?.body).toBe("Plain message");
  expect(record?.participants).toEqual(["contact@example.test"]);
  expect(
    normalizeCalendar({
      id: "event",
      start: { date: "2026-10-05" },
      status: "confirmed",
    }).occurredAt,
  ).toBe("2026-10-05T00:00:00.000Z");
  const message = {
    id: "same-id",
    chat_id: "chat-a",
    is_sender: false,
    is_event: false,
    text: "Reply",
    timestamp: "2026-10-05T00:00:00.000Z",
  };
  expect(normalizeLinkedIn(message)?.externalId).not.toBe(
    normalizeLinkedIn({ ...message, chat_id: "chat-b" })?.externalId,
  );
});

test("expired history cursors reset only for documented 404/410 responses; outages remain failures", async () => {
  const missing = vi.fn<typeof fetch>(async () =>
    json({ error: "old cursor" }, 404),
  );
  expect(
    await readProviderPage(
      "gmail",
      { accessToken: "test" },
      "account",
      "owner@example.test",
      { historyId: "old" },
      missing,
    ),
  ).toEqual({ records: [], cursor: { mode: "initial" }, more: true });
  const gone = vi.fn<typeof fetch>(async () => json({ error: "gone" }, 410));
  expect(
    (
      await readProviderPage(
        "calendar",
        { accessToken: "test" },
        "account",
        "owner@example.test",
        { syncToken: "old" },
        gone,
      )
    ).more,
  ).toBe(true);
  const outage = vi.fn<typeof fetch>(async () =>
    json({ error: "server failure with secret" }, 500),
  );
  await expect(
    readProviderPage(
      "gmail",
      { accessToken: "test" },
      "account",
      "owner@example.test",
      { historyId: "old" },
      outage,
    ),
  ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  await expect(
    providerJson("https://example.test", {}, outage),
  ).rejects.not.toThrow("secret");
});

test("LinkedIn signed callback retries are idempotent and cannot revive a disconnected account", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    json({ link: "https://auth.unipile.com/temporary-link" }),
  );
  const service = new IntegrationService(local.db, transport);
  await service.connect(admin, { ...scope, provider: "linkedin" });
  const { state } = JSON.parse(String(transport.mock.calls[0][1]?.body));
  const account = {
    id: "retry-linked-account",
    provider: "linkedin",
    name: "Fictional account",
    status: "running",
  };
  const first = await service.linkedInAccount(state, account, demoId(980));
  expect((await service.linkedInAccount(state, account, demoId(980))).id).toBe(
    first.id,
  );
  await service.disconnect(admin, scope.organizationId, first.id);
  await expect(
    service.linkedInAccount(state, account, demoId(980)),
  ).rejects.toMatchObject({
    code: "CONNECTION_FLOW_EXPIRED",
  });
});

test("durable webhook receipts deduplicate deliveries, retry sanitized failures, and discard disconnected accounts", async () => {
  const { saveReceipt, processReceipts } = await import(
    "../packages/connectors/receipts"
  );
  const transport = vi.fn<typeof fetch>(async () =>
    json({ link: "https://auth.unipile.com/temporary-link" }),
  );
  const service = new IntegrationService(local.db, transport);
  await service.connect(admin, { ...scope, provider: "linkedin" });
  const { state } = JSON.parse(String(transport.mock.calls[0][1]?.body));
  const connection = await service.linkedInAccount(
    state,
    {
      id: "receipt-account",
      provider: "linkedin",
      name: "Fictional",
      status: "running",
    },
    demoId(980),
  );
  const payload = {
    id: "receipt-message",
    chat_id: "receipt-chat",
    is_sender: false,
    is_event: false,
    text: "Private imported reply",
    timestamp: "2026-10-05T00:00:00.000Z",
  };
  await saveReceipt(local.db, connection, "evt-receipt", "unipile", payload);
  await saveReceipt(local.db, connection, "evt-receipt", "unipile", payload);
  expect(
    await local.db
      .select()
      .from(s.integrationReceipts)
      .where(eq(s.integrationReceipts.connectionId, connection.id)),
  ).toHaveLength(1);
  expect(await processReceipts(local.db)).toEqual({ processed: 0, failed: 0 });
  expect(
    await local.db
      .select()
      .from(s.integrationItems)
      .where(eq(s.integrationItems.connectionId, connection.id)),
  ).toHaveLength(1);
  await saveReceipt(local.db, connection, "evt-bad", "unipile", {
    id: "invalid",
  });
  expect(await processReceipts(local.db)).toEqual({ processed: 0, failed: 1 });
  const [failed] = await local.db
    .select()
    .from(s.integrationReceipts)
    .where(eq(s.integrationReceipts.externalId, "evt-bad"));
  expect(failed.errorCode).toBe("PROVIDER_RESPONSE_INVALID");
  expect(failed.attempts).toBe(1);
  expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  await saveReceipt(local.db, connection, "evt-after", "unipile", {
    ...payload,
    id: "after",
    timestamp: "invalid",
  });
  await service.disconnect(admin, scope.organizationId, connection.id);
  expect(await processReceipts(local.db)).toEqual({ processed: 1, failed: 0 });
  expect(
    await local.db
      .select()
      .from(s.integrationItems)
      .where(eq(s.integrationItems.connectionId, connection.id)),
  ).toHaveLength(1);
  await expect(
    service.importRecord(connection, {
      externalId: "stale",
      kind: "message",
      threadId: "receipt-chat",
      title: "Stale",
      body: "Must not persist",
      occurredAt: payload.timestamp,
      direction: "inbound",
      participants: [],
    }),
  ).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
});

test("Google refresh keeps the refresh credential and fails safely on revoked access", async () => {
  const { refreshGoogle } = await import("../packages/connectors/providers");
  const transport = vi.fn<typeof fetch>(async () =>
    json({ access_token: "renewed", expires_in: 3600 }),
  );
  const refreshed = await refreshGoogle(
    { accessToken: "old", refreshToken: "persistent", expiresAt: 1 },
    transport,
  );
  expect(refreshed.refreshToken).toBe("persistent");
  expect(refreshed.accessToken).toBe("renewed");
  expect(
    new URLSearchParams(String(transport.mock.calls[0][1]?.body)).get(
      "grant_type",
    ),
  ).toBe("refresh_token");
  await expect(
    refreshGoogle({ refreshToken: "revoked" }, async () =>
      json({ error: "private vendor response" }, 400),
    ),
  ).rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
});

test("provider payloads are size bounded before parsing and failures never expose provider bodies", async () => {
  await expect(
    providerJson(
      "https://provider.example.test",
      {},
      async () => new Response("x".repeat(4000001)),
    ),
  ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
});

test("historical backfill records context without pausing current outreach or creating a new reply task", async () => {
  const { ingestReply } = await import("../packages/connectors/replies");
  const [connection] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.externalAccountId, "integration-google-user"));
  await local.db.insert(s.conversations).values({
    organizationId: scope.organizationId,
    productId: scope.productId,
    relationshipId: demoId(300),
    connectionId: connection.id,
    externalThreadId: "old-history",
    ownerId: admin.userId,
    visibility: "private",
    channel: "gmail",
  });
  const beforeActions = await local.db.select().from(s.actions);
  const beforeEnrollments = await local.db.select().from(s.enrollments);
  await ingestReply(local.db, {
    provider: "gmail",
    accountId: connection.externalAccountId,
    messageId: "old-only-inbound",
    threadId: "old-history",
    direction: "inbound",
    channel: "gmail",
    body: "An old message",
    occurredAt: "2026-09-01T00:00:00.000Z",
    historical: true,
  });
  expect(await local.db.select().from(s.actions)).toEqual(beforeActions);
  expect(await local.db.select().from(s.enrollments)).toEqual(
    beforeEnrollments,
  );
});

test("private review pages preserve microseconds and tied timestamps while filtering source, product and owner", async () => {
  const service = new IntegrationService(local.db);
  const connectionIds = [
    demoId(18000),
    demoId(18001),
    demoId(18002),
    demoId(18003),
  ];
  await local.db.insert(s.connections).values(
    connectionIds.map((id, index) => ({
      id,
      organizationId: scope.organizationId,
      productId: index === 3 ? demoId(11) : scope.productId,
      ownerId: index === 2 ? another.userId : admin.userId,
      provider: index === 1 ? ("fireflies" as const) : ("gmail" as const),
      externalAccountId: `fictional-review-page-${index}`,
      status: "connected" as const,
    })),
  );
  const record: ImportRecord = {
    externalId: "fictional-page",
    kind: "meeting",
    title: "Fictional paging review",
    body: "Fictional private fixture",
    occurredAt: "2026-10-01T00:00:00.000Z",
    participants: ["paging@example.test"],
  };
  try {
    await local.db.insert(s.integrationItems).values(
      Array.from({ length: 64 }, (_, index) => ({
        id: demoId(19000 + index),
        organizationId: scope.organizationId,
        productId: index === 63 ? demoId(11) : scope.productId,
        connectionId:
          connectionIds[
            index === 61 ? 1 : index === 62 ? 2 : index === 63 ? 3 : 0
          ],
        externalId: `fictional-page-${index}`,
        record: {
          ...record,
          externalId: `fictional-page-${index}`,
          title: index === 0 ? "Fictional paging 100%_complete" : record.title,
        },
        // The first 40 share an exact timestamp; the rest differ by microseconds within one JS millisecond.
        createdAt: sql`'2026-10-01 00:00:00.123000+00'::timestamptz + ${Math.max(0, index - 39)} * interval '1 microsecond'`,
      })),
    );
    const scopeWithSearch = { ...scope, reviewQuery: "Fictional paging" };
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.overview(admin, {
        ...scopeWithSearch,
        reviewCursor: cursor,
      });
      expect(page.items.length).toBeLessThanOrEqual(20);
      expect(page.reviewTotal).toBe(62);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextReviewCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(
      Array.from({ length: 62 }, (_, i) => demoId(19061 - i)),
    );
    expect(new Set(seen).size).toBe(62);
    const first = await service.overview(admin, scopeWithSearch);
    // Removing a reviewed boundary row must not invalidate the next-page cursor.
    await local.db
      .update(s.integrationItems)
      .set({ status: "ignored" })
      .where(eq(s.integrationItems.id, first.items.at(-1)?.id ?? ""));
    const second = await service.overview(admin, {
      ...scopeWithSearch,
      reviewCursor: first.nextReviewCursor ?? undefined,
    });
    expect(second.items[0].id).toBe(demoId(19041));
    expect(second.reviewTotal).toBe(61);
    expect(
      (
        await service.overview(admin, {
          ...scopeWithSearch,
          reviewProvider: "fireflies",
        })
      ).items.map((i) => i.id),
    ).toEqual([demoId(19061)]);
    expect(
      (
        await service.overview(admin, {
          ...scope,
          reviewQuery: "paging@example.test",
          reviewProvider: "fireflies",
        })
      ).reviewTotal,
    ).toBe(1);
    expect(
      (
        await service.overview(admin, { ...scope, reviewQuery: "%_" })
      ).items.map((i) => i.id),
    ).toEqual([demoId(19000)]);
    expect(
      (await service.overview(another, scopeWithSearch)).items.map((i) => i.id),
    ).toEqual([demoId(19062)]);
    expect(
      (
        await service.overview(admin, {
          organizationId: scope.organizationId,
          reviewQuery: "Fictional paging",
        })
      ).reviewTotal,
    ).toBe(62);
    await expect(
      service.overview(admin, {
        ...scopeWithSearch,
        reviewCursor: "not-a-cursor",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      service.overview({ ...admin, source: "mcp" }, scopeWithSearch),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
  } finally {
    await local.db
      .delete(s.integrationItems)
      .where(inArray(s.integrationItems.connectionId, connectionIds));
    await local.db
      .delete(s.connections)
      .where(inArray(s.connections.id, connectionIds));
  }
});

test("failed receipt review pages preserve microseconds, owner privacy, product grants and bounded sanitized summaries", async () => {
  const ids = Array.from({ length: 3 }, () => randomUUID());
  await local.db.insert(s.connections).values(
    ids.map((id, index) => ({
      id,
      organizationId: scope.organizationId,
      productId: index === 2 ? demoId(11) : scope.productId,
      ownerId: index === 1 ? another.userId : admin.userId,
      provider: "unipile" as const,
      externalAccountId: `fictional-failed-review-${id}`,
      status: "connected" as const,
    })),
  );
  const prefix = `fictional-failed-page-${randomUUID()}`;
  try {
    await local.db.insert(s.integrationReceipts).values(
      Array.from({ length: 45 }, (_, index) => ({
        organizationId: scope.organizationId,
        connectionId: ids[index === 43 ? 1 : index === 44 ? 2 : 0],
        externalId: `${prefix}-${index.toString().padStart(2, "0")}`,
        provider: "unipile" as const,
        payload: { privateBody: "Fictional retained private source" },
        errorCode: "PROVIDER_RESPONSE_INVALID",
        createdAt: sql`'2026-10-01 00:00:00.123000+00'::timestamptz + ${Math.max(0, index - 25)} * interval '1 microsecond'`,
      })),
    );
    const service = new IntegrationService(local.db);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.overview(admin, {
        ...scope,
        reviewProvider: "linkedin",
        reviewQuery: prefix,
        failedReceiptCursor: cursor,
      });
      expect(page.failedReceipts.length).toBeLessThanOrEqual(20);
      expect(page.failedReceiptTotal).toBe(43);
      expect(page.items).toEqual([]);
      expect(JSON.stringify(page.failedReceipts)).not.toContain("privateBody");
      seen.push(...page.failedReceipts.map((item) => item.externalId));
      cursor = page.nextFailedReceiptCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(43);
    expect(new Set(seen).size).toBe(43);
    expect(
      (
        await service.overview(another, { ...scope, reviewQuery: prefix })
      ).failedReceipts.map((item) => item.externalId),
    ).toEqual([`${prefix}-43`]);
    expect(
      (
        await service.overview(admin, {
          ...scope,
          reviewQuery: prefix,
          reviewProvider: "gmail",
        })
      ).failedReceipts,
    ).toEqual([]);
    expect(
      (
        await service.overview(
          {
            ...admin,
            source: "mcp",
            organizationId: scope.organizationId,
            productIds: [scope.productId],
            readOnly: true,
          },
          {
            organizationId: scope.organizationId,
            reviewQuery: prefix,
          },
        )
      ).failedReceiptTotal,
    ).toBe(43);
    expect(
      (
        await service.overview(
          {
            ...admin,
            source: "mcp",
            organizationId: scope.organizationId,
            readOnly: true,
          },
          { ...scope, reviewQuery: prefix },
        )
      ).failedReceipts.every((item) => !item.canDiscard),
    ).toBe(true);
    await expect(
      service.overview(admin, {
        ...scope,
        failedReceiptCursor: "not-a-valid-cursor",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  } finally {
    await local.db
      .delete(s.integrationReceipts)
      .where(inArray(s.integrationReceipts.connectionId, ids));
    await local.db.delete(s.connections).where(inArray(s.connections.id, ids));
  }
});

test("a synced reply from a secondary address on an unlinked thread pauses that person in every brand, and a backfill pauses nothing", async () => {
  const service = new IntegrationService(local.db, authTransport);
  const crm = new CrmService(local.db);
  const outreach = new OutreachService(local.db);
  const records = new RecordService(local.db);
  const [gmail] = await local.db
    .select()
    .from(s.connections)
    .where(eq(s.connections.externalAccountId, "integration-google-user"));
  gmail.syncCursor = { connectedAt: "2026-10-01T00:00:00.000Z" };
  await local.db
    .update(s.connections)
    .set({ syncCursor: gmail.syncCursor })
    .where(eq(s.connections.id, gmail.id));
  const enrolled = async (name: string, email: string, other: string) => {
    const first = await crm.createPerson(admin, {
      organizationId: scope.organizationId,
      productId: demoId(10),
      name,
      email,
      title: "",
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
    const second = await crm.createPerson(admin, {
      organizationId: scope.organizationId,
      productId: demoId(12),
      personId: first.personId,
      title: "",
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
    const [person] = await local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, first.personId));
    await records.updatePerson(admin, {
      organizationId: scope.organizationId,
      productId: demoId(10),
      personId: first.personId,
      version: person?.version ?? 1,
      name,
      title: "",
      email,
      otherEmails: [other],
      phone: "",
      linkedinUrl: "",
      summary: "",
    });
    for (const [sequenceId, relationshipId] of [
      [demoId(400), first.relationshipId],
      [demoId(402), second.relationshipId],
    ] as const)
      await outreach.enroll(admin, {
        organizationId: scope.organizationId,
        sequenceId,
        relationshipIds: [relationshipId],
        dryRun: false,
      });
    return [first.relationshipId, second.relationshipId];
  };
  const statuses = async (relationshipIds: string[]) =>
    (
      await local.db
        .select()
        .from(s.enrollments)
        .where(inArray(s.enrollments.relationshipId, relationshipIds))
    ).map((row) => [row.status, row.pauseReason]);
  const live = await enrolled(
    "Synced reply fixture",
    "synced-primary@example.test",
    "synced-secondary@example.test",
  );
  const backfilled = await enrolled(
    "Backfill fixture",
    "backfill-primary@example.test",
    "backfill-secondary@example.test",
  );
  const reply = (
    externalId: string,
    from: string,
    occurredAt: string,
  ): ImportRecord => ({
    externalId,
    threadId: `${externalId}-thread`,
    kind: "message",
    title: "Fictional reply",
    body: "Fictional reply body",
    occurredAt,
    direction: "inbound",
    participants: [from],
    from,
  });
  await service.importRecord(
    gmail,
    reply(
      "backfill-reply",
      "Backfill-Secondary@Example.test",
      "2026-09-20T09:00:00.000Z",
    ),
  );
  expect(await statuses(backfilled)).toEqual([
    ["running", null],
    ["running", null],
  ]);
  await service.importRecord(
    gmail,
    reply(
      "synced-reply",
      "Synced-Secondary@Example.TEST",
      "2026-10-04T09:00:00.000Z",
    ),
  );
  expect(await statuses(live)).toEqual([
    ["paused", "reply"],
    ["paused", "reply"],
  ]);
  const [item] = await local.db
    .select()
    .from(s.integrationItems)
    .where(eq(s.integrationItems.externalId, "synced-reply"));
  expect(item?.status).toBe("unmatched");
});
