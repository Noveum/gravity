import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  instantFromZonedInput,
  zonedInputValue,
} from "../packages/core/calendar";
import { CrmService } from "../packages/core/crm";
import {
  fieldFilterSchema,
  matchesFieldFilters,
} from "../packages/core/field-filters";
import {
  changeInternalTaskSchema,
  createInternalTaskSchema,
  InternalTaskService,
  nextInternalTaskDue,
} from "../packages/core/internal-tasks";
import {
  RecordListService,
  recordListSchema,
} from "../packages/core/record-list";
import {
  emptyRelationshipDetails,
  type RelationshipField,
  relationshipFieldSchema,
} from "../packages/core/relationship-context";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { operations } from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const principal = { userId: demoUser, source: "demo" as const };
const scope = { organizationId: demoId(1), productId: demoId(10) };
const fields: RelationshipField[] = [
  { id: demoId(8900), label: " Seats ", type: "number", value: 12 },
  {
    id: demoId(8901),
    label: "\tSegment\u00a0",
    type: "text",
    value: "Enterprise",
  },
  { id: demoId(8902), label: "Verified", type: "boolean", value: false },
  { id: demoId(8903), label: "Review date", type: "date", value: "2030-03-04" },
  {
    id: demoId(8904),
    label: "Review time",
    type: "datetime",
    value: "2030-03-04T04:30:18.125Z",
  },
  { id: demoId(8906), label: "Unused seats", type: "number", value: 0 },
  { id: demoId(8907), label: "İD", type: "text", value: "ΟΣ" },
];
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  await local.db
    .update(s.relationships)
    .set({ contextDetails: { ...emptyRelationshipDetails(), fields } })
    .where(eq(s.relationships.id, demoId(300)));
  await local.db
    .update(s.relationships)
    .set({
      contextDetails: {
        ...emptyRelationshipDetails(),
        fields: [
          {
            id: demoId(8905),
            label: "Private product marker",
            type: "text",
            value: "hidden",
          },
        ],
      },
    })
    .where(eq(s.relationships.id, demoId(306)));
});
afterAll(async () => {
  await local.client.close();
});

describe("precise relationship fields", () => {
  test("datetime schemas and wall-clock inputs preserve seconds and milliseconds", () => {
    expect(relationshipFieldSchema.parse(fields[4]).value).toBe(
      "2030-03-04T04:30:18.125Z",
    );
    expect(
      zonedInputValue("2030-03-04T04:30:18.125Z", "Asia/Kolkata", true),
    ).toBe("2030-03-04T10:00:18.125");
    expect(
      instantFromZonedInput("2030-03-04T10:00:18.125", "Asia/Kolkata"),
    ).toBe("2030-03-04T04:30:18.125Z");
    expect(instantFromZonedInput("2030-02-30T10:00", "UTC")).toBe("");
    expect(instantFromZonedInput("2030-03-04T10:00", "Invalid/Zone")).toBe("");
    expect(instantFromZonedInput("2026-03-08T02:30", "America/New_York")).toBe(
      "",
    );
  });
  test("typed comparisons reject incompatible values and operators", () => {
    expect(
      fieldFilterSchema.safeParse({
        label: "Verified",
        type: "boolean",
        operator: "gt",
        value: false,
      }).success,
    ).toBe(false);
    expect(
      relationshipFieldSchema.safeParse({
        ...fields[4],
        value: "2030-03-04T04:30:18.1251Z",
      }).success,
    ).toBe(false);
    expect(
      fieldFilterSchema.safeParse({
        label: "Review time",
        type: "datetime",
        operator: "eq",
        value: "2030-03-04T04:30:18.1251Z",
      }).success,
    ).toBe(false);
    expect(
      createInternalTaskSchema.safeParse({
        ...scope,
        ownerId: demoUser,
        title: "Invalid precision",
        dueAt: "2030-03-04T04:30:18.1251Z",
        timeZone: "UTC",
      }).success,
    ).toBe(false);
    expect(
      fieldFilterSchema.safeParse({
        label: "Seats",
        type: "number",
        operator: "eq",
        value: "12",
      }).success,
    ).toBe(false);
    expect(
      fieldFilterSchema.safeParse({
        label: "Segment",
        type: "text",
        operator: "exists",
        value: "anything",
      }).success,
    ).toBe(false);
    expect(
      recordListSchema.safeParse({
        ...scope,
        entity: "assets",
        fieldFilters: [{ label: "Seats", type: "number", operator: "exists" }],
      }).success,
    ).toBe(false);
  });
  test("SQL and UI comparisons match for text, numeric, boolean, date, exact time and presence", async () => {
    const service = new RecordListService(local.db);
    for (const filter of [
      { label: "seats", type: "number", operator: "gte", value: 12 },
      { label: "Segment", type: "text", operator: "contains", value: "PRISE" },
      { label: "Verified", type: "boolean", operator: "eq", value: false },
      { label: "Unused seats", type: "number", operator: "eq", value: 0 },
      { label: "İD", type: "text", operator: "eq", value: "ΟΣ" },
      { label: "id", type: "text", operator: "contains", value: "ΟΣ" },
      {
        label: "Review date",
        type: "date",
        operator: "lt",
        value: "2030-03-05",
      },
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
      { label: "Segment", type: "text", operator: "exists" },
    ]) {
      const parsed = fieldFilterSchema.parse(filter);
      expect(matchesFieldFilters(fields, [parsed])).toBe(true);
      const page = await service.page(
        principal,
        recordListSchema.parse({
          ...scope,
          entity: "relationships",
          fieldFilters: JSON.stringify([parsed]),
        }),
      );
      expect(page.items.map((row) => row.id)).toContain(demoId(300));
    }
    const missing = fieldFilterSchema.parse({
      label: "Segment",
      type: "text",
      operator: "missing",
    });
    expect(matchesFieldFilters(fields, [missing])).toBe(false);
    const page = await service.page(
      principal,
      recordListSchema.parse({
        ...scope,
        entity: "relationships",
        fieldFilters: [missing],
      }),
    );
    expect(page.items.map((row) => row.id)).not.toContain(demoId(300));
    for (const filter of [
      { label: "Seats", type: "number", operator: "lt", value: 12 },
      { label: "Verified", type: "boolean", operator: "eq", value: true },
      { label: "Segment", type: "text", operator: "eq", value: "ent" },
      {
        label: "Review time",
        type: "datetime",
        operator: "eq",
        value: "2030-03-04T04:30:18.124Z",
      },
    ]) {
      const parsed = fieldFilterSchema.parse(filter);
      expect(matchesFieldFilters(fields, [parsed])).toBe(false);
      const result = await service.page(
        principal,
        recordListSchema.parse({
          ...scope,
          entity: "relationships",
          fieldFilters: [parsed],
        }),
      );
      expect(result.items.map((row) => row.id)).not.toContain(demoId(300));
    }
  });
  test("filters page every related entity and preserve current product grants", async () => {
    const service = new RecordListService(local.db);
    const filter = [
      { label: "Seats", type: "number", operator: "eq", value: 12 },
    ];
    for (const entity of [
      "people",
      "companies",
      "relationships",
      "opportunities",
      "actions",
      "meetings",
    ] as const) {
      const page = await service.page(
        principal,
        recordListSchema.parse({
          ...scope,
          entity,
          fieldFilters: filter,
          limit: 1,
        }),
      );
      expect(page.total).toBeGreaterThan(0);
      expect(page.items).toHaveLength(1);
    }
    const restricted = {
      ...principal,
      source: "mcp" as const,
      organizationId: scope.organizationId,
      productIds: [demoId(10)],
    };
    const hidden = await service.page(
      restricted,
      recordListSchema.parse({
        organizationId: scope.organizationId,
        entity: "people",
        fieldFilters: [
          { label: "Private product marker", type: "text", operator: "exists" },
        ],
      }),
    );
    expect(hidden.total).toBe(0);
    const mixed = await service.page(
      principal,
      recordListSchema.parse({
        organizationId: scope.organizationId,
        entity: "people",
        fieldFilters: [
          ...filter,
          { label: "Private product marker", type: "text", operator: "exists" },
        ],
      }),
    );
    expect(mixed.total).toBe(0);
    const snapshot = await new CrmService(local.db).snapshot(
      restricted,
      { organizationId: scope.organizationId },
      true,
    );
    expect(
      snapshot.relationships.find((row) => row.id === demoId(300))
        ?.contextFields,
    ).toEqual(fields);
    expect(snapshot.relationships.some((row) => row.id === demoId(306))).toBe(
      false,
    );
  });
});

describe("product-owned internal tasks", () => {
  const input = (changes: object = {}) =>
    createInternalTaskSchema.parse({
      ...scope,
      ownerId: demoUser,
      title: "Fictional internal review",
      dueAt: "2030-01-31T04:30:18.125Z",
      timeZone: "Asia/Kolkata",
      ...changes,
    });
  const change = (
    task: { id: string; version: number },
    command: "complete" | "reopen",
  ) =>
    changeInternalTaskSchema.parse({
      ...scope,
      taskId: task.id,
      version: task.version,
      command,
    });
  test("monthly completion is atomic, retains calendar anchors and never creates delivery", async () => {
    const service = new InternalTaskService(local.db, () =>
      Date.parse("2030-01-31T05:00:00Z"),
    );
    const task = await service.create(
      principal,
      input({ recurrence: { frequency: "monthly", interval: 1 } }),
    );
    expect(task.relationshipId).toBeNull();
    const [advanced] = await Promise.allSettled([
      service.change(principal, change(task, "complete")),
      service.change(principal, change(task, "complete")),
    ]).then((results) => {
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      return results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
    });
    expect(advanced).toMatchObject({
      status: "open",
      version: 2,
      recurrence: { anchorDay: 31 },
    });
    expect(advanced.dueAt.toISOString()).toBe("2030-02-28T04:30:18.125Z");
    const saved = await service.change(
      principal,
      changeInternalTaskSchema.parse({
        ...scope,
        taskId: advanced.id,
        version: advanced.version,
        command: "save",
        title: "Updated internal review",
        recurrence: { frequency: "monthly", interval: 1 },
        dueAt: advanced.dueAt.toISOString(),
        timeZone: advanced.timeZone,
      }),
    );
    const march = await service.change(principal, change(saved, "complete"));
    expect(march.dueAt.toISOString()).toBe("2030-03-31T04:30:18.125Z");
    const events = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.entityId, task.id));
    expect(
      events.filter((event) => event.type === "internal_task.completed"),
    ).toHaveLength(2);
    expect(await local.db.select().from(s.deliveries)).toHaveLength(0);
  });
  test("daily and weekly recurrence preserve wall clock through DST and skip missed dates", () => {
    expect(
      nextInternalTaskDue(
        new Date("2026-03-07T14:00:18.125Z"),
        "America/New_York",
        { frequency: "daily", interval: 1, anchorDay: 7 },
        Date.parse("2026-03-07T15:00:00Z"),
      ).toISOString(),
    ).toBe("2026-03-08T13:00:18.125Z");
    expect(
      nextInternalTaskDue(
        new Date("2030-01-01T09:00:00Z"),
        "UTC",
        { frequency: "weekly", interval: 2, anchorDay: 1 },
        Date.parse("2030-02-01T10:00:00Z"),
      ).toISOString(),
    ).toBe("2030-02-12T09:00:00.000Z");
    expect(
      nextInternalTaskDue(
        new Date("2026-03-07T07:30:18.125Z"),
        "America/New_York",
        { frequency: "daily", interval: 1, anchorDay: 7 },
        Date.parse("2026-03-07T08:00:00Z"),
      ).toISOString(),
    ).toBe("2026-03-09T06:30:18.125Z");
    expect(
      nextInternalTaskDue(
        new Date("2026-10-31T13:00:18.125Z"),
        "America/New_York",
        { frequency: "daily", interval: 1, anchorDay: 31 },
        Date.parse("2026-10-31T14:00:00Z"),
      ).toISOString(),
    ).toBe("2026-11-01T14:00:18.125Z");
    expect(
      nextInternalTaskDue(
        new Date("2026-03-01T14:00:18.125Z"),
        "America/New_York",
        { frequency: "weekly", interval: 1, anchorDay: 1 },
        Date.parse("2026-03-01T15:00:00Z"),
      ).toISOString(),
    ).toBe("2026-03-08T13:00:18.125Z");
    // Samoa skipped an entire local day when crossing the date line in 2011.
    expect(
      nextInternalTaskDue(
        new Date("2011-12-29T19:00:18.125Z"),
        "Pacific/Apia",
        { frequency: "daily", interval: 1, anchorDay: 29 },
        Date.parse("2011-12-29T20:00:00Z"),
      ).toISOString(),
    ).toBe("2011-12-30T19:00:18.125Z");
  });
  test("one-off tasks complete/reopen with versions and verify assignees, tenant and product access", async () => {
    const service = new InternalTaskService(local.db);
    const task = await service.create(principal, input());
    const done = await service.change(principal, change(task, "complete"));
    expect(done.status).toBe("completed");
    expect(
      (await service.change(principal, change(done, "reopen"))).status,
    ).toBe("open");
    await expect(
      service.create(principal, input({ ownerId: "not-a-member" })),
    ).rejects.toThrow("OWNER_NOT_ALLOWED");
    await expect(
      service.create(principal, input({ relationshipId: demoId(306) })),
    ).rejects.toThrow("NOT_FOUND");
    const restricted = {
      ...principal,
      source: "mcp" as const,
      organizationId: scope.organizationId,
      productIds: [demoId(11)],
      readOnly: false,
    };
    expect(
      await service.list(restricted, { organizationId: scope.organizationId }),
    ).toHaveLength(0);
    await expect(
      service.change(restricted, change(task, "complete")),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      service.create(
        { ...principal, source: "mcp", organizationId: scope.organizationId },
        input(),
      ),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      service.change(principal, {
        ...change(task, "complete"),
        organizationId: demoId(2),
      }),
    ).rejects.toThrow("NOT_FOUND");
  });
  test("registry executes the complete task schemas for verified MCP reads and writes", async () => {
    const writer = {
      ...principal,
      source: "mcp" as const,
      organizationId: scope.organizationId,
      productIds: [scope.productId],
      readOnly: false,
    };
    const create = operations.find(
      (operation) => operation.name === "create_internal_task",
    );
    const list = operations.find(
      (operation) => operation.name === "list_internal_tasks",
    );
    const update = operations.find(
      (operation) => operation.name === "change_internal_task",
    );
    expect(create?.schema).toBe(createInternalTaskSchema);
    expect(update?.schema).toBe(changeInternalTaskSchema);
    const task = (await create?.execute(
      { db: local.db, principal: writer },
      input({ title: "Fictional MCP task" }),
    )) as { id: string; version: number };
    expect(task.id).toBeTruthy();
    await update?.execute(
      { db: local.db, principal: writer },
      change(task, "complete"),
    );
    expect(
      await list?.execute({ db: local.db, principal: writer }, scope),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: task.id, status: "completed" }),
      ]),
    );
  });
  test("task access and assignee validation recheck revoked product access and membership", async () => {
    const service = new InternalTaskService(local.db);
    const task = await service.create(
      principal,
      input({ ownerId: "demo-teammate" }),
    );
    const teammate = {
      userId: "demo-teammate",
      source: "mcp" as const,
      organizationId: scope.organizationId,
      productIds: [scope.productId],
      readOnly: false,
    };
    expect(await service.list(teammate, scope)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: task.id })]),
    );
    const membershipCondition = and(
      eq(s.productMemberships.organizationId, scope.organizationId),
      eq(s.productMemberships.productId, scope.productId),
      eq(s.productMemberships.userId, teammate.userId),
    );
    await local.db.delete(s.productMemberships).where(membershipCondition);
    try {
      await expect(service.list(teammate, scope)).rejects.toThrow("FORBIDDEN");
      await expect(
        service.change(teammate, change(task, "complete")),
      ).rejects.toThrow("FORBIDDEN");
      await expect(
        service.change(principal, change(task, "complete")),
      ).rejects.toThrow("OWNER_NOT_ALLOWED");
      const reassigned = await service.change(
        principal,
        changeInternalTaskSchema.parse({
          ...scope,
          taskId: task.id,
          version: task.version,
          command: "save",
          ownerId: demoUser,
        }),
      );
      expect(reassigned.ownerId).toBe(demoUser);
    } finally {
      await local.db.insert(s.productMemberships).values({
        organizationId: scope.organizationId,
        productId: scope.productId,
        userId: teammate.userId,
      });
    }
    const memberCondition = and(
      eq(s.memberships.organizationId, scope.organizationId),
      eq(s.memberships.userId, teammate.userId),
    );
    await local.db
      .update(s.memberships)
      .set({ active: false })
      .where(memberCondition);
    try {
      await expect(service.list(teammate, scope)).rejects.toThrow("FORBIDDEN");
      await expect(
        new RecordListService(local.db).page(
          teammate,
          recordListSchema.parse({ ...scope, entity: "people" }),
        ),
      ).rejects.toThrow("FORBIDDEN");
    } finally {
      await local.db
        .update(s.memberships)
        .set({ active: true })
        .where(memberCondition);
    }
  });
});
