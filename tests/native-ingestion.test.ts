import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import {
  editNativeDraftSchema,
  ingestDraftSchema,
  ingestHistorySchema,
  NativeIngestionService,
} from "../packages/core/native-ingestion";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  executeMcpOperation,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const owner: Principal = { userId: demoUser, source: "session" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const scope = { organizationId: demoId(1), productId: demoId(10) };
const now = Date.parse("2026-10-08T12:00:00.000Z");
const historyAt = "2026-10-06T12:34:56.789Z";
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => local.client.close());
async function fixture() {
  const id = randomUUID();
  const person = await new CrmService(local.db).createPerson(owner, {
    ...scope,
    name: `Fictional ingestion ${id}`,
    email: `${id}@example.test`,
    title: "",
    purpose: "buyer",
    context: "",
    review: false,
    channel: "gmail",
  });
  return {
    ...scope,
    relationshipId: person.relationshipId,
    personId: person.personId,
    service: new NativeIngestionService(local.db, () => now),
    sourceThreadId: id,
    channel: "gmail" as const,
    messages: [
      {
        sourceMessageId: `${id}-message`,
        body: "A fictional historical message",
        direction: "outbound" as const,
        occurredAt: historyAt,
      },
    ],
  };
}

test("native write schemas share a serialized UTF-8 budget below the HTTP envelope limit", () => {
  const relationshipId = demoId(300);
  const history = {
    ...scope,
    relationshipId,
    channel: "gmail" as const,
    sourceThreadId: "fictional-byte-budget-thread",
    messages: [
      {
        sourceMessageId: "fictional-byte-budget-message",
        direction: "inbound" as const,
        body: "界".repeat(29000),
        occurredAt: historyAt,
      },
    ],
  };
  expect(ingestHistorySchema.safeParse(history).success).toBe(true);
  expect(
    ingestHistorySchema.safeParse({
      ...history,
      messages: [{ ...history.messages[0], body: "界".repeat(30000) }],
    }).success,
  ).toBe(false);
  const draft = {
    ...scope,
    relationshipId,
    sourceId: "fictional-byte-budget-draft",
    channel: "gmail" as const,
    title: "Fictional Unicode draft",
    reason: "界".repeat(10000),
    body: "界".repeat(19000),
  };
  expect(ingestDraftSchema.safeParse(draft).success).toBe(true);
  expect(
    ingestDraftSchema.safeParse({ ...draft, body: "界".repeat(20000) }).success,
  ).toBe(false);
  const edit = { ...draft, draftId: randomUUID(), version: 1 };
  expect(editNativeDraftSchema.safeParse(edit).success).toBe(true);
  expect(
    editNativeDraftSchema.safeParse({ ...edit, body: "界".repeat(20000) })
      .success,
  ).toBe(false);
});

test("native historical messages remain private, preserve precise instants and deduplicate immutable sources", async () => {
  const f = await fixture();
  const first = await f.service.history(owner, f);
  expect(first).toMatchObject({ created: 1, visibility: "private" });
  expect(await f.service.history(owner, f)).toMatchObject({
    created: 0,
    conversationId: first.conversationId,
    messageIds: first.messageIds,
  });
  const context = await new CrmService(local.db).context(
    owner,
    scope.organizationId,
    f.relationshipId,
  );
  expect(context.messages).toHaveLength(1);
  expect(context.messages[0].occurredAt.toISOString()).toBe(historyAt);
  expect(context.conversations[0]).toMatchObject({
    provenance: "native",
    visibility: "private",
  });
  const [conversation] = await local.db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, first.conversationId));
  expect(conversation.connectionId).toBeNull();
  expect(
    (
      await new CrmService(local.db).context(
        teammate,
        scope.organizationId,
        f.relationshipId,
      )
    ).messages,
  ).toEqual([]);
  await expect(
    f.service.history(owner, {
      ...f,
      messages: [{ ...f.messages[0], body: "Changed source content" }],
    }),
  ).rejects.toMatchObject({ code: "INGESTION_CONFLICT" });
  const other = await fixture();
  await expect(
    f.service.history(owner, { ...f, relationshipId: other.relationshipId }),
  ).rejects.toMatchObject({ code: "INGESTION_CONFLICT" });
  await expect(
    f.service.history(owner, {
      ...f,
      messages: [
        {
          ...f.messages[0],
          sourceMessageId: "future",
          occurredAt: "2026-10-09T00:00:00Z",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "HISTORY_FUTURE" });
});

test("historical imports invalidate current approval without completing current work or creating a reply task", async () => {
  const f = await fixture();
  const crm = new CrmService(local.db);
  const created = await crm.scheduleAction(owner, {
    ...scope,
    relationshipId: f.relationshipId,
    ownerId: owner.userId,
    title: "Fictional current reply",
    reason: "Reviewed synthetic notes",
    kind: "reply",
    channel: "gmail",
    owedBy: "us",
    dueAt: new Date(now).toISOString(),
  });
  const approved = await crm.changeAction(owner, {
    ...scope,
    actionId: created.actionId,
    version: 1,
    command: "approve",
    draft: "Subject: Fictional\n\nBody.",
  });
  await f.service.history(owner, f);
  const context = await crm.context(
    owner,
    scope.organizationId,
    f.relationshipId,
  );
  expect(context.actions).toHaveLength(1);
  expect(context.actions[0]).toMatchObject({
    id: created.actionId,
    status: "open",
    approvedHash: null,
    version: approved.version + 1,
  });
  expect(context.relationship.lastOutboundAt?.toISOString()).toBe(historyAt);
});

test("undated drafts require an explicit precise schedule, retain owner privacy and create only one unapproved action", async () => {
  const f = await fixture();
  const input = {
    ...scope,
    relationshipId: f.relationshipId,
    channel: "gmail" as const,
    sourceId: randomUUID(),
    title: "Fictional undated draft",
    reason: "Readable notes",
    body: "Subject: Fictional\n\nAn undated draft.",
  };
  const draft = await f.service.draft(owner, input);
  expect(await f.service.draft(owner, input)).toMatchObject({
    id: draft.id,
    version: 1,
    scheduledActionId: null,
  });
  expect(
    (
      await new CrmService(local.db).context(
        owner,
        scope.organizationId,
        f.relationshipId,
      )
    ).actions,
  ).toEqual([]);
  expect(
    (
      await f.service.drafts(teammate, {
        ...scope,
        relationshipId: f.relationshipId,
      })
    ).items,
  ).toEqual([]);
  await expect(
    f.service.edit(teammate, {
      ...scope,
      draftId: draft.id,
      version: 1,
      ...input,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const edited = await f.service.edit(owner, {
    ...scope,
    draftId: draft.id,
    version: 1,
    ...input,
    reason: "Edited readable notes",
  });
  expect(await f.service.draft(owner, input)).toMatchObject({
    id: draft.id,
    version: edited.version,
    reason: "Edited readable notes",
  });
  await expect(
    f.service.draft(owner, { ...input, body: "A changed original source" }),
  ).rejects.toMatchObject({ code: "INGESTION_CONFLICT" });
  await expect(
    f.service.schedule(owner, {
      ...scope,
      draftId: draft.id,
      version: 1,
      dueAt: historyAt,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const scheduled = await f.service.schedule(owner, {
    ...scope,
    draftId: draft.id,
    version: edited.version,
    dueAt: historyAt,
  });
  expect(
    await f.service.schedule(owner, {
      ...scope,
      draftId: draft.id,
      version: edited.version,
      dueAt: historyAt,
    }),
  ).toEqual(scheduled);
  await expect(
    f.service.schedule(owner, {
      ...scope,
      draftId: draft.id,
      version: scheduled.version,
      dueAt: "2026-10-07T00:00:00Z",
    }),
  ).rejects.toMatchObject({ code: "INGESTION_CONFLICT" });
  const [action] = await local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, scheduled.actionId));
  expect(action).toMatchObject({
    draft: input.body,
    approvedHash: null,
    approvedBy: null,
    ownerId: owner.userId,
    sourceConversationId: draft.sourceConversationId,
  });
  expect(action.dueAt.toISOString()).toBe(historyAt);
  expect(
    (
      await new CrmService(local.db).context(
        teammate,
        scope.organizationId,
        f.relationshipId,
      )
    ).actions,
  ).toEqual([]);
  await expect(
    f.service.edit(owner, {
      ...scope,
      draftId: draft.id,
      version: scheduled.version,
      ...input,
    }),
  ).rejects.toMatchObject({ code: "DRAFT_ALREADY_SCHEDULED" });
});

test("native ingestion is registered for UI/MCP with unchanged organization and product grants", async () => {
  const f = await fixture();
  const assistant: Principal = {
    ...owner,
    source: "mcp",
    organizationId: scope.organizationId,
    readOnly: false,
    productIds: [scope.productId],
  };
  const operation = operations.find((item) => item.name === "ingest_history");
  expect(operation?.api).toBe("crm");
  expect(operation?.operation).toBe("ingest-history");
  const {
    service: _service,
    personId: _personId,
    organizationId: _organizationId,
    ...input
  } = f;
  expect(
    await executeMcpOperation(
      operation as NonNullable<typeof operation>,
      { db: local.db, principal: assistant },
      scope.organizationId,
      input,
    ),
  ).toMatchObject({ created: 1 });
  await expect(
    f.service.history({ ...assistant, productIds: [demoId(11)] }, f),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    f.service.history(owner, { ...f, organizationId: demoId(2) }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    f.service.history({ ...assistant, readOnly: true }, f),
  ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
});

test("native draft pagination reaches every owned draft through ties and microsecond boundaries", async () => {
  const f = await fixture();
  const drafts = [];
  for (let index = 0; index < 101; index++)
    drafts.push(
      await f.service.draft(owner, {
        ...scope,
        relationshipId: f.relationshipId,
        sourceId: `fictional-page-${randomUUID()}`,
        channel: "gmail",
        title: `Fictional page draft ${index}`,
        reason: "Synthetic pagination notes",
        body: "A fictional undated body",
      }),
    );
  const last = drafts[100];
  await local.db
    .update(s.nativeDrafts)
    .set({ createdAt: sql`timestamptz '2026-10-01T00:00:00.123456Z'` })
    .where(eq(s.nativeDrafts.relationshipId, f.relationshipId));
  await local.db
    .update(s.nativeDrafts)
    .set({ createdAt: sql`timestamptz '2026-10-01T00:00:00.123789Z'` })
    .where(eq(s.nativeDrafts.id, last.id));
  await f.service.draft(teammate, {
    ...scope,
    relationshipId: f.relationshipId,
    sourceId: randomUUID(),
    channel: "gmail",
    title: "Another owner's fictional draft",
    reason: "",
    body: "Private teammate body",
  });
  const first = await f.service.drafts(owner, {
    ...scope,
    relationshipId: f.relationshipId,
    limit: 100,
  });
  expect(first.items).toHaveLength(100);
  expect(new Set(first.items.map((draft) => draft.id)).size).toBe(100);
  expect(first.items.some((draft) => draft.id === last.id)).toBe(false);
  expect(JSON.parse(first.nextCursor ?? "{}").createdAt).toBe(
    "2026-10-01T00:00:00.123456Z",
  );
  const operation = operations.find(
    (item) => item.name === "list_native_drafts",
  );
  if (!operation) throw new Error("native draft list operation");
  const second = await executeMcpOperation(
    operation,
    {
      db: local.db,
      principal: {
        ...owner,
        source: "mcp",
        organizationId: scope.organizationId,
        readOnly: false,
        productIds: [scope.productId],
      },
    },
    scope.organizationId,
    {
      productId: scope.productId,
      relationshipId: f.relationshipId,
      cursor: first.nextCursor,
      limit: 100,
    },
  );
  expect(second).toMatchObject({ items: [{ id: last.id }], nextCursor: null });
  const edited = await f.service.edit(owner, {
    ...scope,
    draftId: last.id,
    version: last.version,
    channel: last.channel,
    title: "Edited final fictional draft",
    reason: last.reason,
    body: last.body,
  });
  const scheduled = await f.service.schedule(owner, {
    ...scope,
    draftId: last.id,
    version: edited.version,
    dueAt: historyAt,
  });
  expect(
    await f.service.drafts(owner, {
      ...scope,
      relationshipId: f.relationshipId,
      cursor: first.nextCursor ?? undefined,
      limit: 100,
    }),
  ).toMatchObject({
    items: [{ id: last.id, scheduledActionId: scheduled.actionId }],
    nextCursor: null,
  });
  expect(
    (
      await f.service.drafts(teammate, {
        ...scope,
        relationshipId: f.relationshipId,
        limit: 100,
      })
    ).items,
  ).toHaveLength(1);
  await expect(
    f.service.drafts(owner, {
      ...scope,
      relationshipId: f.relationshipId,
      cursor: "malformed",
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    f.service.drafts(owner, {
      ...scope,
      relationshipId: f.relationshipId,
      cursor: JSON.stringify({
        createdAt: "0000-01-01T00:00:00Z",
        id: randomUUID(),
      }),
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

test("read-only assistants cannot list an archived person's private native drafts", async () => {
  const f = await fixture();
  const draft = await f.service.draft(owner, {
    ...scope,
    relationshipId: f.relationshipId,
    sourceId: randomUUID(),
    channel: "gmail",
    title: "Fictional archived draft",
    reason: "",
    body: "Archived fictional body",
  });
  await local.db
    .update(s.people)
    .set({ archivedAt: new Date() })
    .where(eq(s.people.id, f.personId));
  const reader: Principal = {
    ...owner,
    source: "mcp",
    organizationId: scope.organizationId,
    productIds: [scope.productId],
    readOnly: true,
  };
  await expect(
    f.service.drafts(reader, { ...scope, relationshipId: f.relationshipId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (
      await f.service.drafts(
        { ...reader, readOnly: false },
        { ...scope, relationshipId: f.relationshipId },
      )
    ).items[0].id,
  ).toBe(draft.id);
  expect(
    (
      await f.service.drafts(owner, {
        ...scope,
        relationshipId: f.relationshipId,
      })
    ).items[0].id,
  ).toBe(draft.id);
});
