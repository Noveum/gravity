import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import { serialize } from "../packages/core/dto";
import {
  RecordListService,
  recordListSchema,
} from "../packages/core/record-list";
import {
  RecordMetadataService,
  recordMetadataSchema,
} from "../packages/core/record-metadata";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { operations } from "../packages/operations/catalog";
import { pageWindow } from "../src/components/records/list-browser";
import { findAction } from "../src/components/records/person-panels";
import { splitRecordText } from "../src/components/records/record-text";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const principal = { userId: demoUser, source: "demo" as const };
const scope = { organizationId: demoId(1) };
const metadata = (
  recordId: string,
  entity: "person" | "company" | "relationship" | "opportunity",
  version = 1,
) =>
  recordMetadataSchema.parse({
    ...scope,
    recordId,
    entity,
    version,
    tags: [" Enterprise ", "enterprise", "Priority"],
    amountMinor: 2500000,
    currency: "usd",
  });
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => {
  await local.client.close();
});

describe("record metadata", () => {
  test("migration preserves records with unknown deal size and empty tags", async () => {
    const snapshot = await new CrmService(local.db).snapshot(principal, scope);
    expect(snapshot.people[0]).toMatchObject({
      tags: [],
      amountMinor: null,
      currency: "USD",
    });
    expect(snapshot.companies[0]).toMatchObject({
      tags: [],
      amountMinor: null,
    });
    expect(snapshot.relationships[0]).toMatchObject({
      tags: [],
      amountMinor: null,
    });
  });
  test("tags and money persist for all four supported records with versioned events", async () => {
    const snapshot = await new CrmService(local.db).snapshot(principal, scope);
    const records = [
      ["person", snapshot.people[0]],
      ["company", snapshot.companies[0]],
      ["relationship", snapshot.relationships[0]],
      ["opportunity", snapshot.opportunities[0]],
    ] as const;
    for (const [entity, record] of records) {
      if (!record) throw new Error("missing fixture");
      const result = await new RecordMetadataService(local.db).save(
        principal,
        metadata(record.id, entity, record.version),
      );
      expect(result.record).toMatchObject({
        id: record.id,
        version: record.version + 1,
        tags: ["enterprise", "Priority"],
        amountMinor: 2500000,
        currency: "USD",
      });
      await expect(
        new RecordMetadataService(local.db).save(
          principal,
          metadata(record.id, entity, record.version),
        ),
      ).rejects.toThrow("CONFLICT");
      const [event] = await local.db
        .select()
        .from(s.changeEvents)
        .where(eq(s.changeEvents.entityId, record.id));
      expect(event).toBeTruthy();
    }
  });
  test("writes enforce organization, product grants, archived records and assistant permissions", async () => {
    const snapshot = await new CrmService(local.db).snapshot(principal, scope);
    const person = snapshot.people[0];
    const foreign = (
      await new CrmService(local.db).snapshot(principal, {
        organizationId: demoId(2),
      })
    ).people[0];
    if (!person || !foreign) throw new Error("missing fixture");
    const service = new RecordMetadataService(local.db);
    await expect(
      service.save(principal, metadata(foreign.id, "person", foreign.version)),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      service.save(
        { ...principal, source: "mcp", organizationId: scope.organizationId },
        metadata(person.id, "person", person.version),
      ),
    ).rejects.toThrow("HUMAN_ACTION_REQUIRED");
    await expect(
      service.save(
        {
          ...principal,
          source: "mcp",
          organizationId: scope.organizationId,
          readOnly: false,
          productIds: [demoId(12)],
        },
        metadata(demoId(200), "person", 1),
      ),
    ).rejects.toThrow();
    await local.db
      .update(s.people)
      .set({ archivedAt: new Date() })
      .where(eq(s.people.id, foreign.id));
    await expect(
      service.save(principal, {
        ...metadata(foreign.id, "person", foreign.version),
        organizationId: demoId(2),
      }),
    ).rejects.toThrow("RECORD_ARCHIVED");
  });
  test("external metadata rejects oversized tags, invalid currency and unsafe amounts", () => {
    const input = metadata(demoId(200), "person");
    for (const changes of [
      { tags: ["x".repeat(51)] },
      { tags: Array.from({ length: 31 }, () => "tag") },
      { currency: "ZZZ" },
      { amountMinor: -1 },
      { amountMinor: 2147483648 },
    ])
      expect(
        recordMetadataSchema.safeParse({ ...input, ...changes }).success,
      ).toBe(false);
  });
});

describe("bounded record queries", () => {
  test("SQL filters run before stable paging and money ranges keep currencies separate", async () => {
    const service = new RecordListService(local.db);
    const filtered = await service.page(
      principal,
      recordListSchema.parse({
        ...scope,
        entity: "people",
        tag: "ENTERPRISE",
        minimum: 2000000,
        maximum: 3000000,
        currency: "USD",
        limit: 1,
      }),
    );
    expect(filtered.total).toBe(1);
    expect(filtered.items).toHaveLength(1);
    expect(filtered.nextOffset).toBeNull();
    const yen = await service.page(
      principal,
      recordListSchema.parse({
        ...scope,
        entity: "people",
        tag: "enterprise",
        currency: "JPY",
      }),
    );
    expect(yen.total).toBe(0);
    const first = await service.page(
      principal,
      recordListSchema.parse({ ...scope, entity: "people", limit: 2 }),
    );
    const second = await service.page(
      principal,
      recordListSchema.parse({
        ...scope,
        entity: "people",
        limit: 2,
        offset: 2,
      }),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    expect(
      first.items
        .map((row) => row.id)
        .some((id) => second.items.some((row) => row.id === id)),
    ).toBe(false);
  });
  test("all supported collections execute without snapshot scans", async () => {
    for (const entity of recordListSchema.shape.entity.options) {
      const result = await new RecordListService(local.db).page(
        principal,
        recordListSchema.parse({ ...scope, entity, limit: 1 }),
      );
      expect(result.items.length).toBeLessThanOrEqual(1);
      expect(
        result.items.every(
          (row) => row.organizationId === scope.organizationId,
        ),
      ).toBe(true);
    }
  });
  test("SQL search matches related contact and company names without broadening scope", async () => {
    const service = new RecordListService(local.db);
    const snapshot = await new CrmService(local.db).snapshot(principal, scope);
    for (const entity of [
      "relationships",
      "actions",
      "opportunities",
      "meetings",
    ] as const) {
      const result = await service.page(
        principal,
        recordListSchema.parse({ ...scope, entity, query: "Mira Chen" }),
      );
      const relationships = new Set(
        snapshot.relationships
          .filter((relationship) => relationship.personId === demoId(200))
          .map((relationship) => relationship.id),
      );
      expect(result.items.map((row) => row.id).sort()).toEqual(
        snapshot[entity]
          .filter((row) =>
            relationships.has(
              "relationshipId" in row ? row.relationshipId : row.id,
            ),
          )
          .map((row) => row.id)
          .sort(),
      );
    }
    const people = await service.page(
      principal,
      recordListSchema.parse({
        ...scope,
        entity: "people",
        query: "Northstar Labs",
      }),
    );
    expect(people.items.map((row) => row.id)).toEqual([demoId(200)]);
    const literal = await service.page(
      principal,
      recordListSchema.parse({ ...scope, entity: "people", query: "%" }),
    );
    expect(literal.total).toBe(0);
  });
  test("list reads preserve product grants and private action visibility", async () => {
    const service = new RecordListService(local.db);
    const restricted = {
      userId: "demo-restricted",
      source: "session" as const,
    };
    const readable = await new CrmService(local.db).snapshot(restricted, scope);
    for (const entity of [
      "people",
      "companies",
      "relationships",
      "opportunities",
      "meetings",
      "actions",
    ] as const) {
      const result = await service.page(
        restricted,
        recordListSchema.parse({ ...scope, entity, limit: 100 }),
      );
      expect(result.items.map((row) => row.id).sort()).toEqual(
        readable[entity].map((row) => row.id).sort(),
      );
    }
    await expect(
      service.page(
        restricted,
        recordListSchema.parse({
          ...scope,
          entity: "people",
          productId: demoId(10),
        }),
      ),
    ).rejects.toThrow("FORBIDDEN");
  });
  test("HTTP and MCP share metadata and record query schemas", () => {
    expect(
      operations.find(
        (operation) => operation.name === "update_record_metadata",
      )?.schema,
    ).toBe(recordMetadataSchema);
    expect(
      operations.find((operation) => operation.name === "list_records")?.schema,
    ).toBe(recordListSchema);
  });
  test("compact snapshots remove imported prose while record context retains it", async () => {
    await local.db
      .update(s.people)
      .set({ summary: 'A readable summary {"source":"fixture"}' })
      .where(eq(s.people.id, demoId(200)));
    const service = new CrmService(local.db);
    const compact = await service.snapshot(principal, scope, true);
    expect(compact.people.find((row) => row.id === demoId(200))?.summary).toBe(
      "",
    );
    const full = await service.personContext(
      principal,
      scope.organizationId,
      demoId(200),
    );
    expect(full.person?.summary).toContain("readable summary");
    const action = full.actions[0];
    if (!action) throw new Error("missing action fixture");
    expect(
      findAction(action.id, serialize(compact), serialize(full))?.reason,
    ).toBe(action.reason);
  });
  test("SQL browsing bounds a workspace with 10,000 additional contacts", {
    timeout: 120000,
  }, async () => {
    await local.db.execute(sql`INSERT INTO people (id, organization_id, name)
      SELECT ('00000000-0000-4000-8000-' || lpad((10000 + value)::text, 12, '0'))::uuid,
      ${scope.organizationId}::uuid, 'Scale fixture ' || lpad(value::text, 5, '0')
      FROM generate_series(0, 9999) AS fixture(value)`);
    await local.db.execute(sql`INSERT INTO relationships (id, organization_id, product_id, person_id, owner_id, purpose)
      SELECT ('00000000-0000-4000-8000-' || lpad((30000 + value)::text, 12, '0'))::uuid,
      ${scope.organizationId}::uuid, ${demoId(10)}::uuid,
      ('00000000-0000-4000-8000-' || lpad((10000 + value)::text, 12, '0'))::uuid,
      ${demoUser}, 'buyer' FROM generate_series(0, 9999) AS fixture(value)`);
    const result = await new RecordListService(local.db).page(
      principal,
      recordListSchema.parse({
        ...scope,
        entity: "people",
        query: "Scale fixture",
        offset: 9950,
        limit: 50,
      }),
    );
    expect(result.total).toBe(10000);
    expect(result.items).toHaveLength(50);
    expect(result.nextOffset).toBeNull();
    expect(result.items[0]).toMatchObject({ name: "Scale fixture 09950" });
    expect(
      recordListSchema.safeParse({
        ...scope,
        entity: "assets",
        tag: "Enterprise",
      }).success,
    ).toBe(false);
  });
});

test("pagination bounds 10,000 rows and clamps deletion and empty states", () => {
  expect(pageWindow(10000, 199, 50)).toEqual({
    page: 199,
    pages: 200,
    start: 9950,
    end: 10000,
  });
  expect(pageWindow(51, 199, 50)).toEqual({
    page: 1,
    pages: 2,
    start: 50,
    end: 51,
  });
  expect(pageWindow(0, 3, 50)).toEqual({ page: 0, pages: 1, start: 0, end: 0 });
});

test("imported JSON is separated without treating prose braces as JSON", () => {
  expect(
    splitRecordText('Keep this note. {"source_ids":["fixture"]}'),
  ).toMatchObject({
    summary: "Keep this note.",
    source: expect.stringContaining("source_ids"),
  });
  expect(splitRecordText("Use {name} in the message.")).toEqual({
    summary: "Use {name} in the message.",
    source: "",
  });
  expect(splitRecordText('{"source":"fixture"}').summary).toBe("");
});
