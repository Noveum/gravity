import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import { OutreachService, outreachListSchema } from "../packages/core/outreach";
import {
  nextActionsSchema,
  RecordListService,
  recordListSchema,
} from "../packages/core/record-list";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  apiOperation,
  executeMcpOperation,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const scope = { organizationId: demoId(1) };
const principal = { userId: demoUser, source: "demo" as const };
const readAssistant = {
  ...principal,
  source: "mcp" as const,
  ...scope,
  readOnly: true,
  productIds: [demoId(10)],
};
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  await local.db
    .update(s.people)
    .set({
      tags: ["reply-owed", "person-signal"],
      amountMinor: 90000,
      currency: "JPY",
    })
    .where(eq(s.people.id, demoId(200)));
  await local.db
    .update(s.companies)
    .set({ tags: ["company-signal"] })
    .where(eq(s.companies.id, demoId(100)));
  await local.db
    .update(s.relationships)
    .set({
      tags: ["relationship-signal"],
      amountMinor: 250000,
      currency: "USD",
      qualification: "qualified",
    })
    .where(eq(s.relationships.id, demoId(300)));
  await local.db
    .update(s.relationships)
    .set({
      tags: ["outreach-signal"],
      amountMinor: 0,
      currency: "USD",
      qualification: "qualified",
    })
    .where(eq(s.relationships.id, demoId(308)));
});
afterAll(async () => {
  await local.client.close();
});

test("every UI filter is in the shared HTTP/MCP schemas", () => {
  for (const name of ["list_due_touches", "get_outreach_queue"])
    expect(
      operations.find((operation) => operation.name === name)?.schema,
    ).toBe(outreachListSchema);
  expect(apiOperation("crm", "GET", "records").schema).toBe(recordListSchema);
  expect(apiOperation("crm", "GET", "next-actions").schema).toBe(
    nextActionsSchema,
  );
  for (const schema of [
    recordListSchema,
    nextActionsSchema,
    outreachListSchema,
  ])
    for (const field of [
      "query",
      "tag",
      "ownerId",
      "qualification",
      "status",
      "size",
      "currency",
      "minimum",
      "maximum",
      "sort",
      "fieldFilters",
    ])
      expect(schema.shape).toHaveProperty(field);
  expect(
    recordListSchema.safeParse({
      ...scope,
      entity: "assets",
      ownerId: demoUser,
    }).success,
  ).toBe(false);
  expect(
    recordListSchema.safeParse({
      ...scope,
      entity: "people",
      minimum: 100,
      maximum: 0,
    }).success,
  ).toBe(false);
});

test("actions and meetings filter inherited metadata before paging without inventing actions from tags", async () => {
  const service = new RecordListService(local.db);
  for (const tag of [
    "person-signal",
    "company-signal",
    "relationship-signal",
  ]) {
    const page = await service.page(
      readAssistant,
      recordListSchema.parse({
        ...scope,
        entity: "actions",
        tag,
        qualification: "qualified",
        ownerId: demoUser,
        currency: "USD",
        minimum: 250000,
        maximum: 250000,
        limit: 1,
      }),
    );
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe(demoId(600));
  }
  const absent = (await apiOperation("crm", "GET", "next-actions").execute(
    { db: local.db, principal: readAssistant },
    { ...scope, kind: "reply", tag: "reply-owed" },
  )) as { total: number };
  expect(absent.total).toBe(0);
  const meetings = await service.page(
    readAssistant,
    recordListSchema.parse({
      ...scope,
      entity: "meetings",
      tag: "person-signal",
      ownerId: demoUser,
      qualification: "qualified",
    }),
  );
  expect(meetings.items.map((row) => row.id)).toContain(demoId(1001));
});

test("opportunities inherit tags and owner but their amount stays an actual deal value", async () => {
  const service = new RecordListService(local.db);
  const [stage] = await local.db
    .select()
    .from(s.stages)
    .where(eq(s.stages.id, demoId(801)));
  if (!stage?.pipelineId) throw new Error("Missing stage fixture");
  const page = await service.page(
    readAssistant,
    recordListSchema.parse({
      ...scope,
      entity: "opportunities",
      tag: "company-signal",
      ownerId: demoUser,
      qualification: "qualified",
      status: "open",
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      size: "unknown",
    }),
  );
  expect(page.items.map((row) => row.id)).toEqual([demoId(1101)]);
  expect(
    (
      await service.page(
        readAssistant,
        recordListSchema.parse({
          ...scope,
          entity: "opportunities",
          minimum: 1,
        }),
      )
    ).total,
  ).toBe(0);
  const owned = await service.page(
    readAssistant,
    recordListSchema.parse({
      ...scope,
      entity: "people",
      ownerId: demoUser,
      qualification: "qualified",
    }),
  );
  expect(owned.items.map((row) => row.id)).toContain(demoId(200));
});

test("amount sorting keeps currencies separate, zero known, unknown last, and paging stable", async () => {
  const service = new RecordListService(local.db);
  const query = recordListSchema.parse({
    ...scope,
    entity: "relationships",
    sort: "amount_desc",
    limit: 1,
  });
  const first = await service.page(principal, query);
  const second = await service.page(principal, { ...query, offset: 1 });
  expect(first.items[0]?.id).toBe(demoId(306));
  expect(second.items[0]?.id).toBe(demoId(300));
  expect(first.nextOffset).toBe(1);
  const zero = await service.page(
    principal,
    recordListSchema.parse({
      ...scope,
      entity: "relationships",
      size: "known",
      minimum: 0,
      maximum: 0,
    }),
  );
  expect(zero.items.map((row) => row.id)).toEqual([demoId(308)]);
});

test("relationship name and amount tie sorts match the person names shown on the board", async () => {
  const service = new RecordListService(local.db);
  const ids = [demoId(300), demoId(308)];
  const previous = await local.db
    .select()
    .from(s.relationships)
    .where(inArray(s.relationships.id, ids));
  try {
    for (const row of previous)
      await local.db
        .update(s.relationships)
        .set({
          tags: [...row.tags, "sort-name-fixture"],
          nextStep:
            row.id === demoId(300) ? "Zebra next step" : "Alpha next step",
          amountMinor: 10000,
          currency: "USD",
        })
        .where(eq(s.relationships.id, row.id));
    const query = recordListSchema.parse({
      ...scope,
      entity: "relationships",
      tag: "sort-name-fixture",
    });
    // Mira sorts before Noor even though their next-step text sorts in reverse.
    for (const sort of ["name", "amount_asc", "amount_desc"] as const) {
      const page = await service.page(readAssistant, { ...query, sort });
      expect(page.items.map((row) => row.id)).toEqual(ids);
    }
    const first = await service.page(readAssistant, {
      ...query,
      sort: "name_desc",
      limit: 1,
    });
    const second = await service.page(readAssistant, {
      ...query,
      sort: "name_desc",
      limit: 1,
      offset: 1,
    });
    expect(first.items.map((row) => row.id)).toEqual([demoId(308)]);
    expect(first.nextOffset).toBe(1);
    expect(second.items.map((row) => row.id)).toEqual([demoId(300)]);
    const search = await service.page(readAssistant, {
      ...query,
      query: "Zebra next step",
    });
    expect(search.items.map((row) => row.id)).toEqual([demoId(300)]);
  } finally {
    for (const row of previous)
      await local.db
        .update(s.relationships)
        .set({
          tags: row.tags,
          nextStep: row.nextStep,
          amountMinor: row.amountMinor,
          currency: row.currency,
        })
        .where(eq(s.relationships.id, row.id));
  }
});

test("outreach filters share metadata, preserve read-only grants and never dispatch", async () => {
  const service = new OutreachService(local.db);
  const input = {
    ...scope,
    tag: "outreach-signal",
    ownerId: demoUser,
    qualification: "qualified",
    currency: "USD",
    size: "known" as const,
    minimum: 0,
    maximum: 0,
    channel: "gmail" as const,
    query: "Noor",
    sort: "name_desc" as const,
  };
  const before = await local.db.select().from(s.touches);
  const due = await service.dueTouches(readAssistant, input);
  expect(
    due.groups.flatMap((group) => group.touches).map((row) => row.id),
  ).toContain(demoId(1307));
  const queue = await service.queue(readAssistant, input);
  expect(queue.drafts.map((row) => row.id)).toContain(demoId(1307));
  expect(queue.approved).toHaveLength(0);
  expect(
    (await service.queue(readAssistant, { ...input, currency: "JPY" })).drafts,
  ).toHaveLength(0);
  await expect(
    service.queue(readAssistant, { ...scope, productId: demoId(12) }),
  ).rejects.toThrow("FORBIDDEN");
  expect(await local.db.select().from(s.touches)).toEqual(before);
});

test("archived outreach history has the UI's unknown amount and USD fallback", async () => {
  await local.db
    .update(s.people)
    .set({ archivedAt: new Date() })
    .where(eq(s.people.id, demoId(200)));
  try {
    const queue = await new OutreachService(local.db).queue(readAssistant, {
      ...scope,
      currency: "USD",
      size: "unknown",
      sort: "amount_desc",
    });
    expect(queue.paused.map((row) => row.id)).toContain(demoId(500));
  } finally {
    await local.db
      .update(s.people)
      .set({ archivedAt: null })
      .where(eq(s.people.id, demoId(200)));
  }
});

test.each(["HTTP", "MCP"] as const)(
  "%s next-action status overrides the pending default while includeCompleted stays compatible",
  async (transport) => {
    const operation = apiOperation("crm", "GET", "next-actions");
    const statuses = ["open", "blocked", "completed"] as const;
    const rows = statuses.map((status, index) => ({
      id: demoId(9800 + index),
      ...scope,
      productId: demoId(10),
      relationshipId: demoId(300),
      ownerId: demoUser,
      kind: "research" as const,
      channel: "research" as const,
      owedBy: "us" as const,
      title: `Status filter fixture ${status}`,
      reason: "Fictional status-filter regression fixture",
      dueAt: new Date("2030-01-01T00:00:00Z"),
      status,
    }));
    await local.db.insert(s.actions).values(rows);
    const call = async (filters: Record<string, unknown>) => {
      const input = { query: "Status filter fixture", ...filters };
      const context = { db: local.db, principal: readAssistant };
      return (
        transport === "HTTP"
          ? await operation.execute(context, { ...scope, ...input })
          : await executeMcpOperation(
              operation,
              context,
              scope.organizationId,
              input,
            )
      ) as { items: { id: string; status: string }[]; total: number };
    };
    try {
      for (const includeCompleted of [undefined, "false", "true"]) {
        const options =
          includeCompleted === undefined ? {} : { includeCompleted };
        const defaults = await call(options);
        expect(defaults.items.map((row) => row.status).sort()).toEqual(
          includeCompleted === "true"
            ? ["blocked", "completed", "open"]
            : ["blocked", "open"],
        );
        for (const status of statuses) {
          const result = await call({ ...options, status });
          expect(result.total).toBe(1);
          expect(result.items).toMatchObject([{ status }]);
        }
      }
      await expect(call({ status: "sent" })).rejects.toThrow();
      await expect(call({ includeCompleted: true })).rejects.toThrow();
    } finally {
      await local.db.delete(s.actions).where(
        inArray(
          s.actions.id,
          rows.map((row) => row.id),
        ),
      );
    }
  },
);

test("saved views expose only actual pending actions and preserve private history", async () => {
  const operation = apiOperation("crm", "GET", "next-actions");
  const readable = await new CrmService(local.db).snapshot(
    readAssistant,
    scope,
  );
  const result = (await operation.execute(
    { db: local.db, principal: readAssistant },
    scope,
  )) as { items: { id: string }[] };
  expect(result.items.map((row) => row.id).sort()).toEqual(
    readable.actions
      .filter((row) => row.status !== "completed")
      .map((row) => row.id)
      .sort(),
  );
  await local.db
    .update(s.conversations)
    .set({ visibility: "private" })
    .where(eq(s.conversations.id, demoId(710)));
  await local.db
    .update(s.actions)
    .set({ sourceConversationId: demoId(710) })
    .where(eq(s.actions.id, demoId(600)));
  const teammate = { userId: "demo-teammate", source: "session" as const };
  const privatePage = (await operation.execute(
    { db: local.db, principal: teammate },
    { ...scope, tag: "company-signal" },
  )) as { items: { id: string }[] };
  expect(privatePage.items.map((row) => row.id)).not.toContain(demoId(600));
  await expect(
    operation.execute(
      { db: local.db, principal: readAssistant },
      { organizationId: demoId(2) },
    ),
  ).rejects.toThrow("FORBIDDEN");
  await local.db
    .update(s.memberships)
    .set({ active: false })
    .where(eq(s.memberships.userId, teammate.userId));
  await expect(
    operation.execute({ db: local.db, principal: teammate }, scope),
  ).rejects.toThrow("FORBIDDEN");
  await local.db
    .update(s.actions)
    .set({ status: "completed" })
    .where(eq(s.actions.id, demoId(600)));
  const pending = (await operation.execute(
    { db: local.db, principal: readAssistant },
    { ...scope, kind: "approval" },
  )) as { total: number };
  const completed = (await operation.execute(
    { db: local.db, principal: readAssistant },
    { ...scope, kind: "approval", includeCompleted: "true" },
  )) as { total: number };
  expect(pending.total).toBe(0);
  expect(completed.total).toBe(1);
});
