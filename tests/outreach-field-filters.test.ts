import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  type FieldFilter,
  fieldFilterSchema,
  matchesFieldFilters,
} from "../packages/core/field-filters";
import { OutreachService } from "../packages/core/outreach";
import {
  emptyRelationshipDetails,
  type RelationshipField,
} from "../packages/core/relationship-context";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  apiOperation,
  executeMcpOperation,
  operationInput,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const scope = { organizationId: demoId(1) };
const principal = {
  userId: demoUser,
  source: "mcp" as const,
  ...scope,
  productIds: [demoId(10)],
  readOnly: true,
};
const fields: RelationshipField[] = [
  { id: demoId(91001), label: "Seats", type: "number", value: 12 },
  { id: demoId(91002), label: "Unused seats", type: "number", value: 0 },
  { id: demoId(91003), label: "Enabled", type: "boolean", value: false },
  { id: demoId(91004), label: "İD", type: "text", value: "ΟΣ" },
  {
    id: demoId(91005),
    label: "Review time",
    type: "datetime",
    value: "2030-03-04T04:30:18.125Z",
  },
];

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  for (const [relationshipId, visibleFields] of [
    [demoId(308), fields],
    [demoId(300), fields],
    [
      demoId(304),
      [{ id: demoId(91001), label: "Seats", type: "number", value: 3 }],
    ],
    [
      demoId(305),
      [{ id: demoId(91001), label: "Seats", type: "number", value: 99 }],
    ],
  ] as const)
    await local.db
      .update(s.relationships)
      .set({
        contextDetails: {
          ...emptyRelationshipDetails(),
          fields: [...visibleFields],
        },
      })
      .where(eq(s.relationships.id, relationshipId));
  await local.db
    .update(s.relationships)
    .set({
      tags: ["field-filter-fixture"],
      qualification: "qualified",
      amountMinor: 0,
      currency: "USD",
    })
    .where(eq(s.relationships.id, demoId(308)));
});
afterAll(async () => {
  await local.client.close();
});

test("outreach and saved-action HTTP/MCP schemas expose typed field predicates", () => {
  for (const operation of [
    apiOperation("outreach", "GET", "due"),
    apiOperation("outreach", "GET", "queue"),
    apiOperation("crm", "GET", "next-actions"),
  ]) {
    expect(operation.schema.shape).toHaveProperty("fieldFilters");
    expect(operationInput(operation).shape).toHaveProperty("fieldFilters");
    expect(
      operation.schema.safeParse({
        ...scope,
        fieldFilters: [
          { label: "Seats", type: "number", operator: "contains", value: 1 },
        ],
      }).success,
    ).toBe(false);
  }
});

test("due and queued work match the UI for typed values, Unicode, precise times and presence", async () => {
  const service = new OutreachService(local.db);
  const predicates: FieldFilter[] = [
    { label: "seats", type: "number", operator: "gte", value: 12 },
    { label: "Unused seats", type: "number", operator: "eq", value: 0 },
    { label: "Enabled", type: "boolean", operator: "eq", value: false },
    { label: "İD", type: "text", operator: "eq", value: "ΟΣ" },
    { label: "İD", type: "text", operator: "contains", value: "Σ" },
    {
      label: "Review time",
      type: "datetime",
      operator: "eq",
      value: "2030-03-04T04:30:18.125Z",
    },
    {
      label: "Review time",
      type: "datetime",
      operator: "gt",
      value: "2030-03-04T04:30:18.124Z",
    },
    { label: "Seats", type: "number", operator: "exists" },
    { label: "Not recorded", type: "text", operator: "missing" },
  ];
  for (const predicate of predicates) {
    const parsed = fieldFilterSchema.parse(predicate);
    expect(matchesFieldFilters(fields, [parsed])).toBe(true);
    const input = { ...scope, query: "Noor", fieldFilters: [parsed] };
    const due = await service.dueTouches(principal, input);
    expect(
      due.groups.flatMap((group) => group.touches).map((row) => row.id),
    ).toEqual([demoId(1307)]);
    const queue = await service.queue(principal, input);
    expect(queue.drafts.map((row) => row.id)).toEqual([demoId(1307)]);
    expect(queue.sent.map((row) => row.id)).toEqual([demoId(1306)]);
    expect(queue.approved).toHaveLength(0);
  }
  const mismatch = {
    label: "Seats",
    type: "number",
    operator: "lt",
    value: 12,
  } as const;
  expect(matchesFieldFilters(fields, [mismatch])).toBe(false);
  const absent = await service.queue(principal, {
    ...scope,
    query: "Noor",
    fieldFilters: [mismatch],
  });
  expect(absent.drafts).toHaveLength(0);
  expect(absent.sent).toHaveLength(0);
});

test("HTTP JSON and MCP array predicates combine with scalar filters without modifying work", async () => {
  const filter = {
    label: "Seats",
    type: "number",
    operator: "eq",
    value: 12,
  } as const;
  const input = {
    ...scope,
    query: "Noor",
    tag: "field-filter-fixture",
    qualification: "qualified",
    ownerId: demoUser,
    minimum: 0,
    maximum: 0,
    currency: "USD",
    status: "planned",
    channel: "gmail",
  };
  const before = await local.db.select().from(s.touches);
  const queueOperation = apiOperation("outreach", "GET", "queue");
  const http = await queueOperation.execute(
    { db: local.db, principal },
    { ...input, fieldFilters: JSON.stringify([filter]) },
  );
  const mcp = await executeMcpOperation(
    queueOperation,
    { db: local.db, principal },
    scope.organizationId,
    { ...input, fieldFilters: [filter] },
  );
  for (const result of [http, mcp])
    expect(
      (result as Awaited<ReturnType<OutreachService["queue"]>>).drafts.map(
        (row) => row.id,
      ),
    ).toEqual([demoId(1307)]);
  expect(await local.db.select().from(s.touches)).toEqual(before);
});

test("paused fields follow current grants and archived contacts have no visible fields", async () => {
  const service = new OutreachService(local.db);
  const filter = {
    label: "Seats",
    type: "number",
    operator: "eq",
    value: 12,
  } as const;
  const input = { ...scope, status: "paused" as const, fieldFilters: [filter] };
  expect(
    (await service.queue(principal, input)).paused.map((row) => row.id),
  ).toEqual([demoId(500)]);
  const hidden = await service.queue(principal, {
    ...scope,
    fieldFilters: [{ ...filter, value: 99 }],
  });
  expect(hidden.drafts).toHaveLength(0);
  const allProducts = await service.queue(
    { ...principal, productIds: undefined },
    {
      ...scope,
      fieldFilters: [{ ...filter, value: 99 }],
    },
  );
  expect(allProducts.drafts.map((row) => row.id)).toEqual([demoId(1310)]);
  await expect(
    service.queue(principal, { ...input, productId: demoId(11) }),
  ).rejects.toThrow("FORBIDDEN");
  await local.db
    .update(s.people)
    .set({ archivedAt: new Date() })
    .where(eq(s.people.id, demoId(200)));
  try {
    expect((await service.queue(principal, input)).paused).toHaveLength(0);
    const missing = await service.queue(principal, {
      ...scope,
      query: "Mira",
      status: "paused",
      fieldFilters: [{ label: "Seats", type: "number", operator: "missing" }],
    });
    expect(missing.paused.map((row) => row.id)).toEqual([demoId(500)]);
    const sent = await service.queue(principal, {
      ...scope,
      query: "Mira",
      fieldFilters: [filter],
    });
    expect(sent.sent).toHaveLength(0);
  } finally {
    await local.db
      .update(s.people)
      .set({ archivedAt: null })
      .where(eq(s.people.id, demoId(200)));
  }
});

test("field-filtered queue reads reject revoked current membership and other organizations", async () => {
  const service = new OutreachService(local.db);
  const input = {
    ...scope,
    fieldFilters: [
      { label: "Seats", type: "number", operator: "exists" } as const,
    ],
  };
  await expect(
    service.queue(principal, { ...input, organizationId: demoId(2) }),
  ).rejects.toThrow("FORBIDDEN");
  const membership = and(
    eq(s.memberships.organizationId, scope.organizationId),
    eq(s.memberships.userId, demoUser),
  );
  await local.db.update(s.memberships).set({ active: false }).where(membership);
  try {
    await expect(service.queue(principal, input)).rejects.toThrow("FORBIDDEN");
    await expect(service.dueTouches(principal, input)).rejects.toThrow(
      "FORBIDDEN",
    );
  } finally {
    await local.db
      .update(s.memberships)
      .set({ active: true })
      .where(membership);
  }
});
