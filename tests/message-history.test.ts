import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { CrmService } from "../packages/core/crm";
import { MessageHistoryService } from "../packages/core/message-history";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  apiOperation,
  executeMcpOperation,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const principal: Principal = { userId: demoUser, source: "session" };
const scope = {
  organizationId: demoId(1),
  productId: demoId(10),
  relationshipId: demoId(300),
};
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  const [conversation] = await local.db
    .insert(s.conversations)
    .values({
      organizationId: scope.organizationId,
      productId: scope.productId,
      relationshipId: scope.relationshipId,
      ownerId: demoUser,
      provenance: "native",
      channel: "gmail",
      externalThreadId: "fictional-paginated-source",
    })
    .returning();
  await local.db.insert(s.messages).values(
    Array.from({ length: 35 }, (_, index) => ({
      id: randomUUID(),
      organizationId: scope.organizationId,
      productId: scope.productId,
      conversationId: conversation.id,
      providerMessageId: `fictional-page-${index}`,
      direction: "outbound" as const,
      body: `Fictional historical message ${index}`,
      occurredAt: new Date("2020-01-01T12:34:56.123Z"),
    })),
  );
});

test.each(["page messages", "context messages", "context actions"])(
  "%s cannot expose a thread made private before its body query",
  async (mode) => {
    const [conversation] = await local.db
      .insert(s.conversations)
      .values({
        organizationId: scope.organizationId,
        productId: scope.productId,
        relationshipId: scope.relationshipId,
        ownerId: "demo-teammate",
        provenance: "native",
        channel: "gmail",
        visibility: "product",
        externalThreadId: "fictional-revoked-history",
      })
      .returning();
    const [action] = await local.db
      .insert(s.actions)
      .values({
        organizationId: scope.organizationId,
        productId: scope.productId,
        relationshipId: scope.relationshipId,
        sourceConversationId: conversation.id,
        ownerId: "demo-teammate",
        kind: "reply",
        owedBy: "us",
        channel: "gmail",
        title: "A fictional action from revoked history",
        reason: "Private fictional reason",
        draft: "Private fictional draft",
        dueAt: new Date("2026-10-01T12:34:56.123Z"),
      })
      .returning();
    const [message] = await local.db
      .insert(s.messages)
      .values({
        organizationId: scope.organizationId,
        productId: scope.productId,
        conversationId: conversation.id,
        providerMessageId: "fictional-revoked-message",
        direction: "inbound",
        body: "A fictional message whose sharing was revoked",
        occurredAt: new Date("2026-10-01T12:34:56.123Z"),
      })
      .returning();
    const query = local.client.query.bind(local.client);
    let revoked = false;
    const barrier = vi.spyOn(local.client, "query").mockImplementation((async (
      ...args: Parameters<typeof local.client.query>
    ) => {
      if (
        !revoked &&
        (mode.endsWith("actions")
          ? args[0].includes('from "actions"')
          : args[0].includes('from "messages"') &&
            args[0].includes('join "conversations"'))
      ) {
        revoked = true;
        await local.db
          .update(s.conversations)
          .set({ visibility: "private" })
          .where(eq(s.conversations.id, conversation.id));
      }
      return Reflect.apply(query, local.client, args);
    }) as typeof local.client.query);
    try {
      const page = mode.startsWith("page")
        ? await new MessageHistoryService(local.db).page(principal, {
            ...scope,
            limit: 100,
          })
        : await new CrmService(local.db).context(
            principal,
            scope.organizationId,
            scope.relationshipId,
          );
      expect(revoked).toBe(true);
      if ("actions" in page) {
        if (mode.endsWith("actions"))
          expect(page.actions.some((item) => item.id === action.id)).toBe(
            false,
          );
        const ownContext = await new CrmService(local.db).context(
          { userId: "demo-teammate", source: "session" },
          scope.organizationId,
          scope.relationshipId,
        );
        expect(ownContext.messages.some((item) => item.id === message.id)).toBe(
          true,
        );
        expect(ownContext.actions.some((item) => item.id === action.id)).toBe(
          true,
        );
      }
      if (mode.endsWith("messages"))
        expect(page.messages.some((item) => item.id === message.id)).toBe(
          false,
        );
    } finally {
      barrier.mockRestore();
      await local.db.delete(s.actions).where(eq(s.actions.id, action.id));
      await local.db.delete(s.messages).where(eq(s.messages.id, message.id));
      await local.db
        .delete(s.conversations)
        .where(eq(s.conversations.id, conversation.id));
    }
  },
);
afterAll(async () => {
  await local.client.close();
});

test("UI registry and MCP page stable tied timestamps without repeats and preserve private ownership", async () => {
  const operation = apiOperation("crm", "GET", "messages");
  const assistant: Principal = {
    ...principal,
    source: "mcp",
    organizationId: scope.organizationId,
    productIds: [scope.productId],
    readOnly: true,
  };
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await new MessageHistoryService(local.db).page(principal, {
      ...scope,
      cursor,
      limit: 7,
    });
    ids.push(...page.messages.map((message) => message.id));
    expect(page.accessibleHistoryOnly).toBe(true);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toHaveLength(37);
  expect(new Set(ids).size).toBe(37);
  const result = await executeMcpOperation(
    operation,
    { db: local.db, principal: assistant },
    scope.organizationId,
    {
      productId: scope.productId,
      relationshipId: scope.relationshipId,
      limit: 100,
    },
  );
  expect(result).toMatchObject({
    nextCursor: null,
    accessibleHistoryOnly: true,
    messages: expect.any(Array),
  });
  const teammate = await new MessageHistoryService(local.db).page(
    { userId: "demo-teammate", source: "session" },
    { ...scope, limit: 100 },
  );
  expect(teammate.messages).toHaveLength(2);
  expect(
    teammate.messages.every((message) => message.provenance === "provider"),
  ).toBe(true);
  await expect(
    new MessageHistoryService(local.db).page(
      { ...assistant, productIds: [demoId(11)] },
      scope,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    new MessageHistoryService(local.db).page(principal, {
      ...scope,
      organizationId: demoId(2),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    new MessageHistoryService(local.db).page(principal, {
      ...scope,
      cursor: '{"id":"fake"}',
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    new MessageHistoryService(local.db).page(principal, {
      ...scope,
      cursor: JSON.stringify({
        occurredAt: "0000-01-01T00:00:00Z",
        id: randomUUID(),
      }),
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

test("message history pages preserve legacy microseconds through HTTP and MCP cursors", async () => {
  const [conversation] = await local.db
    .insert(s.conversations)
    .values({
      organizationId: scope.organizationId,
      productId: scope.productId,
      relationshipId: scope.relationshipId,
      ownerId: demoUser,
      provenance: "native",
      channel: "gmail",
      externalThreadId: randomUUID(),
    })
    .returning();
  const ids: string[] = Array.from({ length: 4 }, () => randomUUID())
    .sort()
    .reverse();
  await local.db.insert(s.messages).values(
    ids.map((id) => ({
      id,
      organizationId: scope.organizationId,
      productId: scope.productId,
      conversationId: conversation.id,
      providerMessageId: id,
      direction: "inbound" as const,
      body: "Fictional message with a legacy precise timestamp",
      occurredAt: new Date("2026-10-01T00:00:00.123Z"),
    })),
  );
  await local.db
    .update(s.messages)
    .set({ occurredAt: sql`timestamptz '2026-10-01T00:00:00.123456Z'` })
    .where(inArray(s.messages.id, ids));
  try {
    const service = new MessageHistoryService(local.db);
    let first = await service.page(principal, {
      ...scope,
      limit: 1,
    });
    while (first.nextCursor && !ids.includes(first.messages[0]?.id ?? ""))
      first = await service.page(principal, {
        ...scope,
        cursor: first.nextCursor,
        limit: 1,
      });
    expect(first.messages.map((message) => message.id)).toEqual([ids[0]]);
    const operation = apiOperation("crm", "GET", "messages");
    const assistant: Principal = {
      ...principal,
      source: "mcp",
      organizationId: scope.organizationId,
      productIds: [scope.productId],
      readOnly: true,
    };
    const second = await executeMcpOperation(
      operation,
      { db: local.db, principal: assistant },
      scope.organizationId,
      {
        productId: scope.productId,
        relationshipId: scope.relationshipId,
        cursor: first.nextCursor,
        limit: 3,
      },
    );
    expect(second).toMatchObject({
      messages: ids.slice(1).map((id) => ({ id })),
    });
    expect(JSON.parse(first.nextCursor ?? "{}").occurredAt).toBe(
      "2026-10-01T00:00:00.123456Z",
    );
  } finally {
    await local.db.delete(s.messages).where(inArray(s.messages.id, ids));
    await local.db
      .delete(s.conversations)
      .where(eq(s.conversations.id, conversation.id));
  }
});
