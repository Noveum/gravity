import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { seal } from "../packages/connectors/security";
import { IntegrationService } from "../packages/connectors/service";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  executeMcpOperation,
  operations,
} from "../packages/operations/catalog";
import { databaseWithLockInterleave } from "./support/lock-interleave";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const owner: Principal = { userId: demoUser, source: "session" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const scope = { organizationId: demoId(1), productId: demoId(10) };
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await local.client.close();
});

test("multiple personal mailboxes remain separately owned; product filters narrow imports, not account management", async () => {
  const integrations = new IntegrationService(local.db);
  const a = await integrations.saveConnected(
    owner,
    scope.organizationId,
    scope.productId,
    "gmail",
    "fictional-inbox-a",
    "a@example.test",
    { accessToken: "fixture" },
    [],
  );
  const b = await integrations.saveConnected(
    owner,
    scope.organizationId,
    demoId(11),
    "gmail",
    "fictional-inbox-b",
    "b@example.test",
    { accessToken: "fixture" },
    [],
  );
  const c = await integrations.saveConnected(
    teammate,
    scope.organizationId,
    scope.productId,
    "gmail",
    "fictional-inbox-c",
    "c@example.test",
    { accessToken: "fixture" },
    [],
  );
  const own = await integrations.overview(owner, scope);
  expect(own.connections.map((row) => row.id)).toEqual(
    expect.arrayContaining([a.id, b.id]),
  );
  expect(own.connections.map((row) => row.id)).not.toContain(c.id);
  expect(JSON.stringify(own)).not.toContain("encryptedCredentials");
  expect(
    (await integrations.overview(teammate, scope)).connections.map(
      (row) => row.id,
    ),
  ).toEqual([c.id]);
  await expect(
    integrations.own(teammate, scope.organizationId, a.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    integrations.saveConnected(
      teammate,
      scope.organizationId,
      scope.productId,
      "gmail",
      "fictional-inbox-a",
      "a@example.test",
      { accessToken: "stolen" },
      [],
    ),
  ).rejects.toMatchObject({ code: "ACCOUNT_ALREADY_CONNECTED" });
  expect(
    (
      await integrations.saveConnected(
        owner,
        scope.organizationId,
        scope.productId,
        "gmail",
        "fictional-inbox-a",
        "a@example.test",
        { accessToken: "renewed" },
        [],
        a.id,
      )
    ).id,
  ).toBe(a.id);
  await local.db.insert(s.integrationItems).values({
    organizationId: scope.organizationId,
    productId: demoId(11),
    connectionId: b.id,
    externalId: "private-other-product",
    record: {
      externalId: "private-other-product",
      kind: "message",
      title: "Other product",
      body: "Private fictional content",
      occurredAt: "2026-10-01T00:00:00Z",
      participants: [],
    },
  });
  expect((await integrations.overview(owner, scope)).items).toEqual([]);
  const restricted: Principal = {
    ...owner,
    source: "mcp",
    organizationId: scope.organizationId,
    readOnly: false,
    productIds: [scope.productId],
  };
  expect(
    (await integrations.overview(restricted, scope)).connections.map(
      (row) => row.id,
    ),
  ).not.toContain(b.id);
});

test("one owner can connect several LinkedIn accounts without transferring provider credentials", async () => {
  const integrations = new IntegrationService(local.db);
  const configurationId = randomUUID();
  await local.db.insert(s.providerConfigurations).values({
    id: configurationId,
    organizationId: scope.organizationId,
    ownerId: owner.userId,
    provider: "unipile",
    encryptedCredentials: seal(
      { apiKey: "fictional-v2-token" },
      `${scope.organizationId}:${owner.userId}:${configurationId}:provider`,
    ),
  });
  const accounts = await Promise.all(
    ["linkedin-one", "linkedin-two"].map((id) =>
      integrations.saveConnected(
        owner,
        scope.organizationId,
        scope.productId,
        "linkedin",
        id,
        id,
        {},
        [],
        undefined,
        undefined,
        configurationId,
      ),
    ),
  );
  expect(new Set(accounts.map((row) => row.id)).size).toBe(2);
  const visible = (
    await integrations.overview(owner, scope)
  ).connections.filter((row) => row.provider === "linkedin");
  expect(visible).toHaveLength(2);
  expect(
    (await integrations.overview(teammate, scope)).connections.some(
      (row) => row.provider === "linkedin",
    ),
  ).toBe(false);
});

test("thread owners can share and revoke product visibility through the common MCP/API operation", async () => {
  const crm = new CrmService(local.db);
  const conversationId = demoId(710);
  await local.db
    .update(s.conversations)
    .set({ visibility: "private" })
    .where(eq(s.conversations.id, conversationId));
  const operation = operations.find(
    (item) => item.name === "set_conversation_visibility",
  );
  if (!operation) throw Error("Missing sharing operation");
  const input = {
    ...scope,
    conversationId,
    expectedVisibility: "private",
    visibility: "product",
  };
  const before = await crm.context(teammate, scope.organizationId, demoId(300));
  expect(
    before.conversations.some((source) => source.id === conversationId),
  ).toBe(false);
  const beforeRevision = await crm.revision(teammate, scope.organizationId);
  await executeMcpOperation(
    operation,
    { db: local.db, principal: { ...owner, source: "mcp", readOnly: false } },
    scope.organizationId,
    input,
  );
  const shared = await crm.context(teammate, scope.organizationId, demoId(300));
  expect(
    shared.conversations.find((source) => source.id === conversationId),
  ).toMatchObject({ visibility: "product" });
  expect(shared.messages.length).toBeGreaterThan(before.messages.length);
  expect(await crm.revision(teammate, scope.organizationId)).not.toBe(
    beforeRevision,
  );
  // Viewing shared content never grants another person the ability to change its access.
  await expect(
    operation.execute(
      { db: local.db, principal: teammate },
      { ...input, expectedVisibility: "product", visibility: "private" },
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    operation.execute(
      { db: local.db, principal: owner },
      { ...input, visibility: "private" },
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await operation.execute(
    { db: local.db, principal: owner },
    { ...input, expectedVisibility: "product", visibility: "private" },
  );
  const hidden = await crm.context(teammate, scope.organizationId, demoId(300));
  expect(
    hidden.conversations.some((source) => source.id === conversationId),
  ).toBe(false);
  expect(hidden.messages).toEqual(before.messages);
  expect(
    (
      await crm.context(owner, scope.organizationId, demoId(300))
    ).conversations.some((source) => source.id === conversationId),
  ).toBe(true);
});

test("sharing cannot bypass read-only grants, tenant isolation or product access", async () => {
  const crm = new CrmService(local.db);
  const input = {
    ...scope,
    conversationId: demoId(710),
    expectedVisibility: "private" as const,
    visibility: "product" as const,
  };
  for (const principal of [
    { ...owner, source: "mcp" as const, readOnly: true },
    {
      ...owner,
      source: "mcp" as const,
      readOnly: false,
      productIds: [demoId(11)],
    },
    { ...owner, organizationId: demoId(2) },
  ])
    await expect(crm.shareConversation(principal, input)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  await expect(
    crm.shareConversation(owner, { ...input, productId: demoId(11) }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("administrators cannot change someone else's private thread or use their inbox", async () => {
  const crm = new CrmService(local.db);
  const integrations = new IntegrationService(local.db);
  await local.db
    .update(s.memberships)
    .set({ role: "admin" })
    .where(eq(s.memberships.userId, teammate.userId));
  try {
    await expect(
      crm.shareConversation(teammate, {
        ...scope,
        conversationId: demoId(710),
        expectedVisibility: "private",
        visibility: "product",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ownAccounts = await integrations.overview(owner, scope);
    const ownerAccount = ownAccounts.connections.find(
      (row) => row.displayName === "a@example.test",
    );
    if (!ownerAccount) throw Error("Missing fixture mailbox");
    await expect(
      integrations.own(teammate, scope.organizationId, ownerAccount.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await local.db
      .update(s.memberships)
      .set({ role: "member" })
      .where(eq(s.memberships.userId, teammate.userId));
  }
});

async function approvalSharingFixture(
  visibility: "private" | "product" = "private",
  actor = owner,
  productId = scope.productId,
) {
  const email = `fictional-sharing-${randomUUID()}@example.test`;
  const personIds: string[] = Array.from({ length: 3 }, () => randomUUID());
  const relationshipIds: string[] = Array.from({ length: 3 }, () =>
    randomUUID(),
  );
  const actionIds: string[] = Array.from({ length: 3 }, () => randomUUID());
  const aliasProductId =
    productId === scope.productId ? demoId(11) : scope.productId;
  const products = [productId, aliasProductId, productId];
  await local.db.insert(s.people).values(
    personIds.map((id, index) => ({
      id,
      organizationId: scope.organizationId,
      name: `Fictional sharing identity ${index}`,
      email: index === 0 ? email : `fictional-${randomUUID()}@example.test`,
      otherEmails: index === 1 ? [email.toUpperCase()] : [],
    })),
  );
  await local.db.insert(s.relationships).values(
    relationshipIds.map((id, index) => ({
      id,
      organizationId: scope.organizationId,
      productId: products[index],
      personId: personIds[index],
      ownerId: index === 1 ? teammate.userId : actor.userId,
      purpose: "buyer",
    })),
  );
  await local.db.insert(s.actions).values(
    actionIds.map((id, index) => ({
      id,
      organizationId: scope.organizationId,
      productId: products[index],
      relationshipId: relationshipIds[index],
      ownerId: index === 1 ? teammate.userId : actor.userId,
      kind: "reply" as const,
      title: "Fictional approved reply",
      reason: "Fictional reviewed context",
      owedBy: "us" as const,
      channel: "gmail" as const,
      dueAt: new Date("2026-10-01T12:00:00Z"),
      draft: "Fictional reviewed answer",
      draftHash: "fictional-approved-hash",
      approvedHash: "fictional-approved-hash",
      approvedBy: owner.userId,
      version: 3,
    })),
  );
  const touchIds: string[] = Array.from({ length: 2 }, () => randomUUID());
  for (const [index, touchId] of touchIds.entries()) {
    const relationshipIndex = index + 1;
    const [enrollment] = await local.db
      .insert(s.enrollments)
      .values({
        organizationId: scope.organizationId,
        productId: products[relationshipIndex],
        relationshipId: relationshipIds[relationshipIndex],
        status: "running",
        sequenceId:
          products[relationshipIndex] === scope.productId
            ? demoId(400)
            : demoId(401),
      })
      .returning();
    await local.db.insert(s.touches).values({
      id: touchId,
      organizationId: scope.organizationId,
      productId: products[relationshipIndex],
      relationshipId: relationshipIds[relationshipIndex],
      enrollmentId: enrollment.id,
      senderId: relationshipIndex === 1 ? teammate.userId : actor.userId,
      stepNumber: 1,
      followUp: 0,
      channel: "gmail",
      dueAt: new Date("2026-10-01T12:00:00Z"),
      status: "approved",
      draft: "Fictional reviewed touch",
      draftHash: "fictional-approved-hash",
      approvedHash: "fictional-approved-hash",
      approvedBy: owner.userId,
      version: 5,
    });
  }
  const [conversation] = await local.db
    .insert(s.conversations)
    .values({
      organizationId: scope.organizationId,
      productId,
      relationshipId: relationshipIds[0],
      ownerId: actor.userId,
      provenance: "native",
      channel: "gmail",
      externalThreadId: randomUUID(),
      visibility,
    })
    .returning();
  const input = {
    organizationId: scope.organizationId,
    productId,
    conversationId: conversation.id,
    expectedVisibility: visibility,
    visibility:
      visibility === "private" ? ("product" as const) : ("private" as const),
  };
  const state = async () => ({
    actions: await local.db
      .select()
      .from(s.actions)
      .where(inArray(s.actions.id, actionIds))
      .orderBy(s.actions.id),
    touches: await local.db
      .select()
      .from(s.touches)
      .where(inArray(s.touches.id, touchIds))
      .orderBy(s.touches.id),
    events: await local.db
      .select()
      .from(s.changeEvents)
      .where(
        inArray(s.changeEvents.entityId, [
          ...actionIds,
          ...touchIds,
          conversation.id,
        ]),
      )
      .orderBy(s.changeEvents.id),
    conversations: await local.db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, conversation.id)),
  });
  return { input, actionIds, touchIds, state };
}

test.each(["private", "product"] as const)(
  "changing %s history visibility invalidates approvals across canonical aliases and products",
  async (visibility) => {
    const fixture = await approvalSharingFixture(visibility);
    const before = await fixture.state();
    await new CrmService(local.db).shareConversation(owner, fixture.input);
    const after = await fixture.state();
    for (const id of fixture.actionIds.slice(0, 2))
      expect(after.actions.find((row) => row.id === id)).toMatchObject({
        approvedHash: null,
        approvedBy: null,
        version: 4,
      });
    expect(
      after.touches.find((row) => row.id === fixture.touchIds[0]),
    ).toMatchObject({
      status: "drafted",
      approvedHash: null,
      approvedBy: null,
      version: 6,
    });
    expect(
      after.actions.find((row) => row.id === fixture.actionIds[2]),
    ).toEqual(before.actions.find((row) => row.id === fixture.actionIds[2]));
    expect(after.touches.find((row) => row.id === fixture.touchIds[1])).toEqual(
      before.touches.find((row) => row.id === fixture.touchIds[1]),
    );
    expect(after.events).toHaveLength(4);
    expect(after.events.map((row) => row.type).sort()).toEqual([
      "action.approval_invalidated",
      "action.approval_invalidated",
      "conversation.visibility",
      "touch.approval_invalidated",
    ]);
    expect(after.conversations[0].visibility).toBe(fixture.input.visibility);
  },
);

test("unchanged sharing and a stale visibility decision retain approvals and audit versions", async () => {
  const fixture = await approvalSharingFixture();
  const before = await fixture.state();
  const crm = new CrmService(local.db);
  expect(
    await crm.shareConversation(owner, {
      ...fixture.input,
      visibility: "private",
    }),
  ).toEqual({ ok: true });
  expect(await fixture.state()).toEqual(before);
  await expect(
    crm.shareConversation(owner, {
      ...fixture.input,
      expectedVisibility: "product",
      visibility: "private",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await fixture.state()).toEqual(before);
});

test.each(["membership", "product grant"])(
  "sharing rechecks %s revocation after waiting for organization authority",
  async (revoked) => {
    const actor: Principal = { userId: "demo-restricted", source: "session" };
    const fixture = await approvalSharingFixture("private", actor, demoId(11));
    const before = await fixture.state();
    const race = databaseWithLockInterleave(local.db, async (tx, statement) => {
      expect(statement).toContain('"organizations"');
      if (revoked === "membership")
        await tx
          .update(s.memberships)
          .set({ active: false })
          .where(
            and(
              eq(s.memberships.organizationId, scope.organizationId),
              eq(s.memberships.userId, actor.userId),
            ),
          );
      else
        await tx
          .delete(s.productMemberships)
          .where(
            and(
              eq(s.productMemberships.organizationId, scope.organizationId),
              eq(s.productMemberships.productId, fixture.input.productId),
              eq(s.productMemberships.userId, actor.userId),
            ),
          );
    });
    await expect(
      new CrmService(race.database).shareConversation(actor, fixture.input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(race.didInterleave()).toBe(true);
    expect(await fixture.state()).toEqual(before);
  },
);
