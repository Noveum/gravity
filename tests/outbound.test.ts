import { randomUUID } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import { OutboundService } from "../packages/connectors/outbound";
import {
  emailDraft,
  gmailSendScope,
  mimeMessage,
} from "../packages/connectors/outbound-provider";
import { decodeMailHeader } from "../packages/connectors/providers";
import { seal } from "../packages/connectors/security";
import { IntegrationService } from "../packages/connectors/service";
import { CrmService } from "../packages/core/crm";
import { OutreachService } from "../packages/core/outreach";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const principal: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: org,
  readOnly: false,
  canSend: true,
};
const human: Principal = { userId: demoUser, source: "session" };
const now = Date.parse("2026-10-06T12:00:00Z");
const clock = () => now;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => local.client.close());
beforeEach(() => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-google-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-google-secret");
  vi.stubEnv("APP_URL", "https://gravity.example.test");
});
afterEach(() => vi.unstubAllEnvs());
let counter = 0;
async function fixture(
  channel: "gmail" | "linkedin" = "gmail",
  actionSource = false,
) {
  counter++;
  const crm = new CrmService(local.db);
  const outreach = new OutreachService(local.db, clock);
  const product = await crm.createProduct(
    human,
    org,
    `Delivery fixture ${counter}`,
  );
  const person = await crm.createPerson(human, {
    organizationId: org,
    productId: product.id,
    name: `Delivery person ${counter}`,
    email: `recipient-${counter}@example.test`,
    title: "",
    purpose: "buyer",
    context: "",
    review: false,
    channel,
  });
  await local.db
    .update(s.people)
    .set({ linkedinUrl: `https://www.linkedin.com/in/fixture-${counter}/` })
    .where(eq(s.people.id, person.personId));
  const connectionId = randomUUID();
  const configurationId = demoId(1980);
  if (channel === "linkedin")
    await local.db
      .insert(s.providerConfigurations)
      .values({
        id: configurationId,
        organizationId: org,
        ownerId: demoUser,
        provider: "unipile",
        webhookReady: true,
        encryptedCredentials: seal(
          { apiKey: "fixture-owner-key" },
          `${org}:${demoUser}:${configurationId}:provider`,
        ),
      })
      .onConflictDoNothing();
  await local.db.insert(s.connections).values({
    id: connectionId,
    organizationId: org,
    productId: product.id,
    ownerId: demoUser,
    provider: channel === "gmail" ? "gmail" : "unipile",
    externalAccountId: `acc_fixture_${counter}`,
    providerConfigurationId: channel === "linkedin" ? configurationId : null,
    status: "connected",
    selfEmail: "sender@example.test",
    encryptedCredentials: seal(
      {
        accessToken: "fixture-access",
        expiresAt: Date.now() + 86400000,
        refreshToken: "fixture-refresh",
      },
      `${org}:${demoUser}:${connectionId}`,
    ),
    scopes:
      channel === "gmail"
        ? ["https://www.googleapis.com/auth/gmail.readonly", gmailSendScope]
        : [],
  });
  const draft =
    channel === "gmail"
      ? "Subject: Fictional proposal\n\nA fictional test message.\nRegards"
      : "Fictional LinkedIn message.";
  let source: { touchId: string } | { actionId: string };
  let version: number;
  if (actionSource) {
    const action = await crm.scheduleAction(human, {
      organizationId: org,
      relationshipId: person.relationshipId,
      ownerId: demoUser,
      kind: "reply",
      title: "Fictional follow-up",
      reason: "Synthetic test",
      dueAt: new Date(now).toISOString(),
      channel,
      owedBy: "us",
    });
    const approved = await crm.changeAction(principal, {
      organizationId: org,
      actionId: action.actionId,
      version: 1,
      command: "approve",
      draft,
    });
    source = { actionId: action.actionId };
    version = approved.version;
  } else {
    const sequence = await outreach.createSequence(principal, {
      organizationId: org,
      productId: product.id,
      name: "Delivery sequence",
      steps: [0, 3].map((delayDays, index) => ({
        number: index + 1,
        name: `Step ${index}`,
        channel,
        delayDays,
        template: draft,
        followUp: index,
      })),
    });
    await outreach.enroll(principal, {
      organizationId: org,
      sequenceId: sequence.id,
      relationshipIds: [person.relationshipId],
      dryRun: false,
    });
    const [touch] = await local.db
      .select()
      .from(s.touches)
      .where(eq(s.touches.relationshipId, person.relationshipId));
    const approved = await outreach.approve(principal, {
      organizationId: org,
      touchId: touch.id,
      version: touch.version,
    });
    source = { touchId: touch.id };
    version = approved.version;
  }
  const transport = vi.fn<typeof fetch>(async (url) => {
    if (String(url).includes("unipile.com") && String(url).endsWith("/chat"))
      return json({ object: "ChatLookup", data: [] });
    if (String(url).includes("unipile.com") && String(url).includes("/users/"))
      return json({
        id: `user_fixture_${counter}`,
        public_identifier: `fixture-${counter}`,
      });
    return channel === "gmail"
      ? json({ id: `sent-${connectionId}`, threadId: `thread-${connectionId}` })
      : json({
          message_id: `sent-${connectionId}`,
          chat_id: `thread-${connectionId}`,
        });
  });
  return {
    crm,
    outreach,
    transport,
    productId: product.id,
    personId: person.personId,
    relationshipId: person.relationshipId,
    source,
    connectionId,
    draft,
    input: {
      organizationId: org,
      ...source,
      connectionId,
      version,
      idempotencyKey: randomUUID(),
    },
    service: new OutboundService(local.db, transport, clock),
  };
}

test("an in-flight send reserves the sender's last daily slot across different products", async () => {
  const first = await fixture();
  const second = await fixture();
  const [baseline] = await local.db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.touches)
    .where(
      and(
        eq(s.touches.senderId, demoUser),
        eq(s.touches.status, "sent"),
        gte(s.touches.sentAt, new Date("2026-10-06T00:00:00Z")),
        lt(s.touches.sentAt, new Date("2026-10-07T00:00:00Z")),
      ),
    );
  const rules = await first.outreach.contactRules(principal, org);
  await first.outreach.updateContactRules(principal, {
    organizationId: org,
    ...rules,
    dailyCapPerSender: baseline.count + 1,
  });
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dispatched = new Promise<void>((resolve) => {
    started = resolve;
  });
  const transport = vi.fn<typeof fetch>(async () => {
    started();
    await waiting;
    return json({ id: "reserved-send", threadId: "reserved-thread" });
  });
  const sending = new OutboundService(local.db, transport, clock).send(
    principal,
    first.input,
  );
  try {
    await dispatched;
    expect(
      (await second.service.readiness(principal, second.input)).blockedBy,
    ).toBe("CONTACT_POLICY_BLOCKED");
    await expect(
      second.service.send(principal, second.input),
    ).rejects.toMatchObject({ code: "CONTACT_POLICY_BLOCKED" });
    expect(second.transport).not.toHaveBeenCalled();
  } finally {
    release();
    expect((await sending).status).toBe("sent");
    await first.outreach.updateContactRules(principal, {
      organizationId: org,
      ...rules,
      version: rules.version + 1,
    });
  }
});
test("an accepted receipt survives bookkeeping failure and a retry never sends again", async () => {
  const f = await fixture();
  const transport = vi.fn<typeof fetch>(async () => {
    vi.spyOn(local.db, "transaction").mockRejectedValueOnce(
      new Error("synthetic bookkeeping failure"),
    );
    return json({ id: "accepted-send", threadId: "accepted-thread" });
  });
  const service = new OutboundService(local.db, transport, clock);
  try {
    await expect(service.send(principal, f.input)).rejects.toThrow(
      "synthetic bookkeeping failure",
    );
    const [delivery] = await local.db
      .select()
      .from(s.deliveries)
      .where(eq(s.deliveries.connectionId, f.connectionId));
    expect(delivery.status).toBe("accepted");
    expect((await service.send(principal, f.input)).status).toBe("sent");
    expect(transport).toHaveBeenCalledTimes(1);
    const messages = await local.db
      .select()
      .from(s.messages)
      .where(eq(s.messages.connectionId, f.connectionId));
    expect(messages).toHaveLength(1);
  } finally {
    vi.restoreAllMocks();
  }
});
test("Gmail sends the approved draft once, persists the receipt/history and plans the next follow-up", async () => {
  const f = await fixture();
  expect((await f.service.readiness(principal, f.input)).ready).toBe(true);
  const sent = await f.service.send(principal, f.input);
  expect(sent.status).toBe("sent");
  expect(sent.providerAccepted).toBe(true);
  expect(await f.service.send(principal, f.input)).toEqual(sent);
  expect(f.transport).toHaveBeenCalledTimes(1);
  const init = f.transport.mock.calls[0][1];
  const mime = Buffer.from(
    JSON.parse(String(init?.body)).raw,
    "base64url",
  ).toString();
  expect(mime).toContain(`To: recipient-${counter}@example.test\r\n`);
  expect(mime).toContain(`Message-ID: <gravity.${sent.id}@example.test>`);
  expect(mime).not.toContain("fixture-access");
  const messages = await local.db
    .select()
    .from(s.messages)
    .where(eq(s.messages.connectionId, f.connectionId));
  expect(messages).toHaveLength(1);
  expect(messages[0].body).toBe(f.draft);
  const [relationship] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, f.relationshipId));
  expect(relationship.touchCount).toBe(1);
  const touches = await local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.relationshipId, f.relationshipId));
  expect(touches.find((touch) => touch.status === "sent")).toBeTruthy();
  expect(touches.find((touch) => touch.stepNumber === 2)).toBeUndefined();
  await new OutreachService(
    local.db,
    () => now + 3 * 86400000,
  ).advanceEnrollments(principal, { organizationId: org });
  const planned = await local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.relationshipId, f.relationshipId));
  expect(planned.find((touch) => touch.stepNumber === 2)?.dueAt.getTime()).toBe(
    now + 3 * 86400000,
  );
  await expect(
    f.service.send(principal, { ...f.input, version: f.input.version + 1 }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
test("send requires verified scope, current membership/product, sender ownership and fresh approval", async () => {
  const f = await fixture();
  for (const denied of [
    { ...principal, canSend: false },
    { ...principal, readOnly: true },
    { ...principal, source: "demo" as const },
  ])
    await expect(f.service.send(denied, f.input)).rejects.toMatchObject({
      code: "SEND_PERMISSION_REQUIRED",
    });
  await expect(
    f.service.send({ ...principal, productIds: [] }, f.input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    f.service.send({ ...principal, userId: "demo-teammate" }, f.input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    f.service.send(principal, { ...f.input, version: 999 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await local.db
    .update(s.people)
    .set({ email: "changed@example.test" })
    .where(eq(s.people.id, f.personId));
  await expect(f.service.send(principal, f.input)).rejects.toMatchObject({
    code: "FRESH_APPROVAL_REQUIRED",
  });
  expect(f.transport).not.toHaveBeenCalled();
});
test("provider send consent is independent of CRM permission and of Google sign-in", async () => {
  const f = await fixture();
  await local.db
    .update(s.connections)
    .set({ scopes: ["https://www.googleapis.com/auth/gmail.readonly"] })
    .where(eq(s.connections.id, f.connectionId));
  expect((await f.service.readiness(principal, f.input)).blockedBy).toBe(
    "GMAIL_SEND_CONSENT_REQUIRED",
  );
  await expect(f.service.send(principal, f.input)).rejects.toMatchObject({
    code: "GMAIL_SEND_CONSENT_REQUIRED",
  });
  expect(f.transport).not.toHaveBeenCalled();
});
test("opt-outs, quiet hours, future dates, paused enrollments and daily caps block actual dispatch", async () => {
  const f = await fixture();
  await local.db
    .update(s.people)
    .set({ doNotContact: true })
    .where(eq(s.people.id, f.personId));
  await expect(f.service.send(principal, f.input)).rejects.toMatchObject({
    code: "DO_NOT_CONTACT",
  });
  await local.db
    .update(s.people)
    .set({ doNotContact: false })
    .where(eq(s.people.id, f.personId));
  await expect(
    new OutboundService(local.db, f.transport, () =>
      Date.parse("2026-10-06T22:00:00Z"),
    ).send(principal, f.input),
  ).rejects.toMatchObject({ code: "CONTACT_POLICY_BLOCKED" });
  if (!("touchId" in f.source)) throw new Error("fixture");
  await local.db
    .update(s.touches)
    .set({ dueAt: new Date(now + 1000) })
    .where(eq(s.touches.id, f.source.touchId));
  await expect(f.service.send(principal, f.input)).rejects.toMatchObject({
    code: "TOUCH_NOT_DUE",
  });
  await local.db
    .update(s.touches)
    .set({ dueAt: new Date(now) })
    .where(eq(s.touches.id, f.source.touchId));
  await local.db
    .update(s.enrollments)
    .set({ status: "paused", pauseReason: "manual" })
    .where(eq(s.enrollments.relationshipId, f.relationshipId));
  await expect(f.service.send(principal, f.input)).rejects.toMatchObject({
    code: "SOURCE_NOT_SENDABLE",
  });
  await local.db
    .update(s.enrollments)
    .set({ status: "running", pauseReason: null })
    .where(eq(s.enrollments.relationshipId, f.relationshipId));
  const rules = await f.outreach.contactRules(principal, org);
  await f.outreach.updateContactRules(principal, {
    organizationId: org,
    ...rules,
    dailyCapPerSender: 1,
  });
  await expect(f.service.send(principal, f.input)).rejects.toMatchObject({
    code: "CONTACT_POLICY_BLOCKED",
  });
  await f.outreach.updateContactRules(principal, {
    organizationId: org,
    ...rules,
    version: rules.version + 1,
    dailyCapPerSender: 40,
  });
  expect(f.transport).not.toHaveBeenCalled();
});
test("unknown outcomes never resend, release approval or allow parallel contacts to evade reservations", async () => {
  const f = await fixture();
  const transport = vi.fn<typeof fetch>(async () => {
    throw new Error("synthetic timeout; secret must never escape");
  });
  const service = new OutboundService(local.db, transport, clock);
  const unknown = await service.send(principal, f.input);
  expect(unknown.status).toBe("unknown");
  expect(unknown.retrySafe).toBe(false);
  expect(await service.send(principal, f.input)).toEqual(unknown);
  await expect(
    service.send(principal, { ...f.input, idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ code: "DELIVERY_IN_PROGRESS" });
  if (!("touchId" in f.source)) throw new Error("fixture");
  await expect(
    f.outreach.editDraft(principal, {
      organizationId: org,
      touchId: f.source.touchId,
      version: f.input.version,
      draft: "changed",
    }),
  ).rejects.toMatchObject({ code: "DELIVERY_IN_PROGRESS" });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(unknown)).not.toContain("secret");
  await expect(
    service.get(
      { ...principal, userId: "demo-teammate" },
      { organizationId: org, deliveryId: unknown.id },
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
test("definitive provider rejection allows a new deliberate attempt but the same key never sends again", async () => {
  const f = await fixture();
  const transport = vi.fn<typeof fetch>(async () =>
    json({ sensitiveProviderError: "do not expose" }, 403),
  );
  const service = new OutboundService(local.db, transport, clock);
  const failed = await service.send(principal, f.input);
  expect(failed.status).toBe("failed");
  expect(failed.retrySafe).toBe(true);
  await service.send(principal, f.input);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(failed)).not.toContain("sensitiveProviderError");
  const sent = await f.service.send(principal, {
    ...f.input,
    idempotencyKey: randomUUID(),
  });
  expect(sent.status).toBe("sent");
});
test("provider 5xx and malformed success receipts remain unknown and are never retried", async () => {
  for (const response of [
    () => json({}, 503),
    () => json({ secret: "not a receipt" }),
  ]) {
    const f = await fixture();
    const transport = vi.fn<typeof fetch>(async () => response());
    const service = new OutboundService(local.db, transport, clock);
    const result = await service.send(principal, f.input);
    expect(result.status).toBe("unknown");
    await service.send(principal, f.input);
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await service.readiness(principal, f.input)).blockedBy).toBe(
      "DELIVERY_IN_PROGRESS",
    );
  }
});
test("Gmail reconciles an unknown send using its unique provider-verified Message-ID without resending", async () => {
  const f = await fixture();
  const failed = await new OutboundService(
    local.db,
    async () => {
      throw new Error("timeout");
    },
    clock,
  ).send(principal, f.input);
  const draft = emailDraft(f.draft);
  const transport = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("?maxResults")
      ? json({ messages: [{ id: "proof-message" }] })
      : json({
          id: "proof-message",
          threadId: "proof-thread",
          internalDate: String(now),
          labelIds: ["SENT"],
          payload: {
            mimeType: "text/plain",
            body: {
              data: Buffer.from(draft.body.replace(/\n/g, "\r\n")).toString(
                "base64url",
              ),
            },
            headers: [
              {
                name: "Subject",
                value: `=?UTF-8?B?${Buffer.from(draft.subject).toString("base64")}?=`,
              },
              {
                name: "Message-ID",
                value: `<gravity.${failed.id}@example.test>`,
              },
              { name: "From", value: "sender@example.test" },
              { name: "To", value: `recipient-${counter}@example.test` },
            ],
          },
        }),
  );
  const service = new OutboundService(local.db, transport, clock);
  const reconciled = await service.reconcile(principal, {
    organizationId: org,
    deliveryId: failed.id,
  });
  expect(reconciled.status).toBe("sent");
  expect(
    transport.mock.calls.every(
      (call) => !call[1]?.method || call[1].method === "GET",
    ),
  ).toBe(true);
  await service.reconcile(principal, {
    organizationId: org,
    deliveryId: failed.id,
  });
  expect(transport).toHaveBeenCalledTimes(2);
  const messages = await local.db
    .select()
    .from(s.messages)
    .where(eq(s.messages.connectionId, f.connectionId));
  expect(messages).toHaveLength(1);
});
test("no Gmail receipt is not proof of failure and cannot release an ambiguous send", async () => {
  const f = await fixture();
  const service = new OutboundService(
    local.db,
    async (_url, init) =>
      init?.method === "POST" ? json({}, 503) : json({ messages: [] }),
    clock,
  );
  const unknown = await service.send(principal, f.input);
  await expect(
    service.reconcile(principal, {
      organizationId: org,
      deliveryId: unknown.id,
    }),
  ).rejects.toMatchObject({ code: "DELIVERY_OUTCOME_UNKNOWN" });
  expect(
    (
      await service.get(principal, {
        organizationId: org,
        deliveryId: unknown.id,
      })
    ).status,
  ).toBe("unknown");
});
test("edits during provider preflight require a fresh approval before any network dispatch", async () => {
  const f = await fixture("linkedin");
  const transport = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith("/chat"))
      return json({ object: "ChatLookup", data: [] });
    if (!("touchId" in f.source)) throw new Error("fixture");
    await f.outreach.editDraft(principal, {
      organizationId: org,
      touchId: f.source.touchId,
      version: f.input.version,
      draft: "A newer draft",
    });
    return json({
      id: "resolved-person",
      public_identifier: `fixture-${counter}`,
    });
  });
  await expect(
    new OutboundService(local.db, transport, clock).send(principal, f.input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(
    transport.mock.calls.every(([, init]) => init?.method === undefined),
  ).toBe(true);
});
test("parallel retries commit one provider call and preserve the same delivery ID", async () => {
  const f = await fixture();
  const results = await Promise.all([
    f.service.send(principal, f.input),
    f.service.send(principal, f.input),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(f.transport).toHaveBeenCalledTimes(1);
});
test("an approved follow-up sends and completes, while a newer inbound reply remains actionable", async () => {
  const f = await fixture("gmail", true);
  if (!("actionId" in f.source)) throw new Error("fixture");
  const actionId = f.source.actionId;
  const transport = vi.fn<typeof fetch>(async () => {
    await local.db
      .update(s.actions)
      .set({
        status: "blocked",
        version: f.input.version + 1,
        approvedHash: null,
      })
      .where(eq(s.actions.id, actionId));
    return json({
      id: `reply-${f.connectionId}`,
      threadId: `reply-thread-${f.connectionId}`,
    });
  });
  const sent = await new OutboundService(local.db, transport, clock).send(
    principal,
    f.input,
  );
  expect(sent.status).toBe("sent");
  expect(sent.errorCode).toBe("SOURCE_CHANGED_DURING_DISPATCH");
  const [action] = await local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, actionId));
  expect(action.status).toBe("blocked");
  const reworked = await f.crm.changeAction(principal, {
    organizationId: org,
    actionId,
    version: action.version,
    command: "rework",
    draft: "Subject: New follow-up\n\nA reviewed response to the newer reply.",
  });
  const approved = await f.crm.changeAction(principal, {
    organizationId: org,
    actionId,
    version: reworked.version,
    command: "approve",
  });
  const later = new OutboundService(
    local.db,
    f.transport,
    () => now + 366 * 86400000,
  );
  const nextInput = {
    ...f.input,
    version: approved.version,
    idempotencyKey: randomUUID(),
  };
  const second = await later.send(principal, nextInput);
  expect(second.status).toBe("sent");
  expect(second.id).not.toBe(sent.id);
  expect((await later.send(principal, nextInput)).id).toBe(second.id);
  expect(f.transport).toHaveBeenCalledTimes(1);
  const ordinary = await fixture("gmail", true);
  expect((await ordinary.service.send(principal, ordinary.input)).status).toBe(
    "sent",
  );
  if (!("actionId" in ordinary.source)) throw new Error("fixture");
  const [completed] = await local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, ordinary.source.actionId));
  expect(completed.status).toBe("completed");
});
test("LinkedIn starts a Classic chat using the stored profile and the owner's private key", async () => {
  const f = await fixture("linkedin");
  const sent = await f.service.send(principal, f.input);
  expect(sent.status).toBe("sent");
  expect(f.transport).toHaveBeenCalledTimes(3);
  expect(String(f.transport.mock.calls[1][0])).toContain(
    `/users/user_fixture_${counter}/chat`,
  );
  expect(String(f.transport.mock.calls[2][0])).toContain(
    "/inboxes/CLASSIC/chats/send",
  );
  expect(JSON.parse(String(f.transport.mock.calls[2][1]?.body))).toEqual({
    text: f.draft,
    users_ids: `user_fixture_${counter}`,
  });
  expect(f.transport.mock.calls[2][1]?.headers).toHaveProperty(
    "X-API-KEY",
    "fixture-owner-key",
  );
  expect(JSON.stringify(sent)).not.toMatch(
    /fixture-owner-key|fixture-access|fixture-refresh/,
  );
});
test("LinkedIn recipient edits invalidate approval and a returned profile mismatch never dispatches", async () => {
  const f = await fixture("linkedin");
  const transport = vi.fn<typeof fetch>(async () =>
    json({ id: "unrelated-user", public_identifier: "wrong-person" }),
  );
  await expect(
    new OutboundService(local.db, transport, clock).send(principal, f.input),
  ).rejects.toMatchObject({ code: "RECIPIENT_MISMATCH" });
  await local.db
    .update(s.people)
    .set({ linkedinUrl: "https://www.linkedin.com/in/changed/" })
    .where(eq(s.people.id, f.personId));
  await expect(f.service.send(principal, f.input)).rejects.toMatchObject({
    code: "FRESH_APPROVAL_REQUIRED",
  });
  expect(f.transport).not.toHaveBeenCalled();
});
test("Gmail replies use a permitted linked thread and RFC reply headers; mismatched threads are denied", async () => {
  const f = await fixture();
  const [conversation] = await local.db
    .insert(s.conversations)
    .values({
      organizationId: org,
      productId: f.productId,
      relationshipId: f.relationshipId,
      connectionId: f.connectionId,
      ownerId: demoUser,
      channel: "gmail",
      externalThreadId: "reply-thread",
    })
    .returning();
  const transport = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("/threads/")
      ? json({
          messages: [
            {
              payload: {
                headers: [
                  { name: "Message-ID", value: "<incoming@example.test>" },
                  { name: "Subject", value: "Fictional proposal" },
                ],
              },
            },
          ],
        })
      : json({ id: `sent-${f.connectionId}`, threadId: "reply-thread" }),
  );
  const service = new OutboundService(local.db, transport, clock);
  expect(
    (
      await service.send(principal, {
        ...f.input,
        conversationId: conversation.id,
      })
    ).status,
  ).toBe("sent");
  const raw = JSON.parse(String(transport.mock.calls[1][1]?.body));
  expect(raw.threadId).toBe("reply-thread");
  expect(Buffer.from(raw.raw, "base64url").toString()).toContain(
    "In-Reply-To: <incoming@example.test>",
  );
  const another = await fixture();
  await expect(
    another.service.send(principal, {
      ...another.input,
      conversationId: conversation.id,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(another.transport).not.toHaveBeenCalled();
});
test("Google mailbox connection requests explicit read/send consent and permits a read-only choice", async () => {
  const f = await fixture();
  const integration = new IntegrationService(local.db, f.transport);
  const consent = await integration.connect(principal, {
    organizationId: org,
    productId: f.productId,
    provider: "gmail",
  });
  expect(new URL(consent.url ?? "").searchParams.get("scope")).toContain(
    gmailSendScope,
  );
  const read = await integration.connect(principal, {
    organizationId: org,
    productId: f.productId,
    provider: "gmail",
    allowSending: false,
  });
  expect(new URL(read.url ?? "").searchParams.get("scope")).not.toContain(
    gmailSendScope,
  );
});
test("MIME encoding handles Unicode without header injection and requires an approved subject", () => {
  expect(() => emailDraft("hello")).toThrow("EMAIL_SUBJECT_REQUIRED");
  expect(() =>
    emailDraft("Subject:\nBcc: hidden@example.test\n\nBody"),
  ).toThrow("EMAIL_SUBJECT_REQUIRED");
  const mime = Buffer.from(
    mimeMessage({
      channel: "gmail",
      accountId: "account",
      from: "me@example.test",
      recipient: "you@example.test",
      subject: "😀".repeat(200),
      body: "Hello\n世界",
      messageId: "fixture@example.test",
    }),
    "base64url",
  ).toString();
  expect(mime.split("\r\n").every((line) => line.length < 100)).toBe(true);
  expect(() =>
    mimeMessage({
      channel: "gmail",
      accountId: "account",
      from: "me@example.test",
      recipient: "you@example.test\r\nBcc: secret@example.test",
      subject: "Subject",
      body: "body",
      messageId: "fixture@example.test",
    }),
  ).toThrow();
});

test("mail subjects decode folded Unicode and quoted-printable words for replies and receipts", () => {
  const part = (value: string) =>
    `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
  expect(
    decodeMailHeader(`${part("Pilot 🌍")}\r\n ${part(" — next step")}`),
  ).toBe("Pilot 🌍 — next step");
  expect(decodeMailHeader("=?UTF-8?Q?Re:_Pilot_=E2=9C=93?=")).toBe(
    "Re: Pilot ✓",
  );
  expect(decodeMailHeader("Plain subject")).toBe("Plain subject");
  expect(decodeMailHeader("=?invalid-charset?B?YWJj?=")).toBe(
    "=?invalid-charset?B?YWJj?=",
  );
});

test("an owned sender can serve another granted product, while either missing product grant denies dispatch", async () => {
  const account = await fixture();
  const target = await fixture();
  const input = { ...target.input, connectionId: account.connectionId };
  for (const productIds of [[target.productId], [account.productId]]) {
    await expect(
      target.service.send({ ...principal, productIds }, input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  expect(target.transport).not.toHaveBeenCalled();
  const granted = {
    ...principal,
    productIds: [account.productId, target.productId],
  };
  expect((await target.service.readiness(granted, input)).ready).toBe(true);
  expect((await target.service.send(granted, input)).status).toBe("sent");
  const [history] = await local.db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.connectionId, account.connectionId));
  expect(history.productId).toBe(target.productId);
  expect(history.relationshipId).toBe(target.relationshipId);
  expect(history.ownerId).toBe(demoUser);
});
test("cross-product receipt verification also requires the sender account's default product grant", async () => {
  const account = await fixture();
  const target = await fixture();
  const input = { ...target.input, connectionId: account.connectionId };
  const transport = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === "POST" ? json({}, 503) : json({ messages: [] }),
  );
  const service = new OutboundService(local.db, transport, clock);
  const granted = {
    ...principal,
    productIds: [account.productId, target.productId],
  };
  const unknown = await service.send(granted, input);
  expect(unknown.status).toBe("unknown");
  await expect(
    service.reconcile(
      { ...principal, productIds: [target.productId] },
      { organizationId: org, deliveryId: unknown.id },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(transport).toHaveBeenCalledTimes(1);
  await expect(
    service.reconcile(granted, { organizationId: org, deliveryId: unknown.id }),
  ).rejects.toMatchObject({ code: "DELIVERY_OUTCOME_UNKNOWN" });
  expect(transport).toHaveBeenCalledTimes(2);
});

test("reopening a sent follow-up clears approval before another deliberate send", async () => {
  const f = await fixture("gmail", true);
  if (!("actionId" in f.source)) throw new Error("fixture");
  await f.service.send(principal, f.input);
  const [completed] = await local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, f.source.actionId));
  const [reopened] = await f.crm.planActions(principal, {
    organizationId: org,
    items: [
      { actionId: completed.id, version: completed.version, status: "open" },
    ],
  });
  expect(reopened.approvedHash).toBeNull();
  const later = new OutboundService(
    local.db,
    f.transport,
    () => now + 366 * 86400000,
  );
  await expect(
    later.send(principal, {
      ...f.input,
      version: reopened.version,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "FRESH_APPROVAL_REQUIRED" });
  const approved = await f.crm.changeAction(principal, {
    organizationId: org,
    actionId: reopened.id,
    version: reopened.version,
    command: "approve",
    draft: "Subject: Another reviewed follow-up\n\nA new reviewed message.",
  });
  f.transport.mockResolvedValueOnce(
    json({ id: "renewed-follow-up", threadId: "renewed-follow-up-thread" }),
  );
  expect(
    (
      await later.send(principal, {
        ...f.input,
        version: approved.version,
        idempotencyKey: randomUUID(),
      })
    ).status,
  ).toBe("sent");
  expect(f.transport).toHaveBeenCalledTimes(2);
  const history = await local.db
    .select()
    .from(s.messages)
    .where(eq(s.messages.connectionId, f.connectionId));
  expect(history).toHaveLength(2);
});
async function linkElsewhere(
  f: Awaited<ReturnType<typeof fixture>>,
  externalThreadId: string,
) {
  const other = await f.crm.createPerson(human, {
    organizationId: org,
    productId: f.productId,
    name: `Linked elsewhere ${counter}`,
    email: `linked-elsewhere-${counter}@example.test`,
    title: "",
    purpose: "buyer",
    context: "",
    review: false,
    channel: "linkedin",
  });
  await local.db.insert(s.conversations).values({
    organizationId: org,
    productId: f.productId,
    relationshipId: other.relationshipId,
    connectionId: f.connectionId,
    externalThreadId,
    ownerId: demoUser,
    channel: "linkedin",
  });
  return other;
}
test("a LinkedIn receipt on a chat linked to another relationship still completes the send", async () => {
  const f = await fixture("linkedin");
  await linkElsewhere(f, `thread-${f.connectionId}`);
  const sent = await f.service.send(principal, f.input);
  expect(sent.status).toBe("sent");
  expect(sent.errorCode).toBe("THREAD_ALREADY_LINKED");
  expect(sent.providerAccepted).toBe(true);
  if (!("touchId" in f.source)) throw new Error("fixture");
  const [touch] = await local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.id, f.source.touchId));
  expect(touch.status).toBe("sent");
  const [relationship] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, f.relationshipId));
  expect(relationship.touchCount).toBe(1);
  expect(relationship.lastOutboundAt?.getTime()).toBe(now);
  const messages = await local.db
    .select()
    .from(s.messages)
    .where(eq(s.messages.connectionId, f.connectionId));
  expect(messages).toHaveLength(0);
  const pending = await local.db
    .select()
    .from(s.deliveries)
    .where(
      and(
        eq(s.deliveries.relationshipId, f.relationshipId),
        sql`${s.deliveries.status} in ('sending', 'unknown', 'accepted')`,
      ),
    );
  expect(pending).toHaveLength(0);
  expect(await f.service.send(principal, f.input)).toEqual(sent);
});
test("a LinkedIn send refuses before claiming when the account's chat with the person is linked elsewhere", async () => {
  const f = await fixture("linkedin");
  const chatId = `existing-chat-${f.connectionId}`;
  await linkElsewhere(f, chatId);
  const transport = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith("/chat"))
      return json({
        object: "ChatLookup",
        data: [{ chat_id: chatId, inbox_id: "CLASSIC", has_history: true }],
      });
    return json({
      id: `user_fixture_${counter}`,
      public_identifier: `fixture-${counter}`,
    });
  });
  await expect(
    new OutboundService(local.db, transport, clock).send(principal, f.input),
  ).rejects.toMatchObject({ code: "THREAD_ALREADY_LINKED" });
  expect(String(transport.mock.calls[1][0])).toContain(
    `/acc_fixture_${counter}/users/user_fixture_${counter}/chat`,
  );
  expect(
    transport.mock.calls.every(([, init]) => init?.method === undefined),
  ).toBe(true);
  const deliveries = await local.db
    .select()
    .from(s.deliveries)
    .where(eq(s.deliveries.connectionId, f.connectionId));
  expect(deliveries).toHaveLength(0);
});
