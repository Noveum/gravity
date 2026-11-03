import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { productSnapshot } from "../packages/core/client-state";
import { CrmService, opportunitySchema } from "../packages/core/crm";
import { serialize } from "../packages/core/dto";
import { PipelineService } from "../packages/core/pipelines";
import type { Principal } from "../packages/core/policy";
import {
  RecordListService,
  recordListSchema,
} from "../packages/core/record-list";
import {
  RecordMetadataService,
  recordMetadataSchema,
} from "../packages/core/record-metadata";
import {
  opportunityArchiveSchema,
  opportunityChangeSchema,
  opportunityCreateSchema,
  opportunityRemovalSchema,
  opportunityRestoreSchema,
  RecordService,
} from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { databaseWithLockInterleave } from "./support/lock-interleave";

type Deal = typeof s.opportunities.$inferSelect;
type ArchiveInput = Parameters<RecordService["archiveOpportunity"]>[1];
let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let records: RecordService;
let crm: CrmService;
const organizationId = demoId(1);
const productId = demoId(10);
const relationshipId = demoId(300);
const scope = { organizationId, productId };
const admin: Principal = { userId: demoUser, source: "demo" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };

beforeEach(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  records = new RecordService(local.db);
  crm = new CrmService(local.db);
});
afterEach(async () => {
  await local.client.close();
});

async function makeDeal(
  changes: Partial<typeof s.opportunities.$inferInsert> = {},
) {
  const [row] = await local.db
    .insert(s.opportunities)
    .values({
      ...scope,
      relationshipId,
      stageId: demoId(801),
      name: "Fictional duplicate evaluation",
      ownerId: demoUser,
      amountMinor: 12345,
      currency: "USD",
      probability: 37,
      expectedCloseDate: "2030-01-31",
      description: "Fictional deal context retained for restoration.",
      tags: ["Evaluation", "Duplicate"],
      createdAt: new Date("2020-01-01T04:30:00.000Z"),
      updatedAt: new Date("2020-02-01T04:30:00.000Z"),
      version: 7,
      ...changes,
    })
    .returning();
  return row;
}
async function deal(id: string) {
  const [row] = await local.db
    .select()
    .from(s.opportunities)
    .where(eq(s.opportunities.id, id));
  if (!row) throw new Error("Missing fictional deal fixture");
  return row;
}
async function events(id: string) {
  return local.db
    .select()
    .from(s.changeEvents)
    .where(eq(s.changeEvents.entityId, id))
    .orderBy(asc(s.changeEvents.createdAt), asc(s.changeEvents.id));
}
function archiveInput(
  row: Deal,
  archived: boolean,
  changes: Partial<ArchiveInput> = {},
) {
  return opportunityArchiveSchema.parse({
    organizationId: row.organizationId,
    productId: row.productId,
    opportunityId: row.id,
    version: row.version,
    archived,
    ...changes,
  });
}
function archive(
  row: Deal,
  archived: boolean,
  changes: Partial<ArchiveInput> = {},
) {
  return records.archiveOpportunity(
    admin,
    archiveInput(row, archived, changes),
  );
}
function retainedState(row: Deal) {
  const { archivedAt: _archivedAt, version: _version, ...retained } = row;
  return retained;
}
function saveInput(row: Deal) {
  return opportunitySchema.parse({
    ...row,
    ownerId: row.ownerId ?? demoUser,
  });
}

describe("reversible deal removal", () => {
  test.each([
    {
      name: "open known",
      status: "open",
      stage: 801,
      amount: 12345,
      probability: 37,
    },
    {
      name: "open unknown",
      status: "open",
      stage: 801,
      amount: null,
      probability: null,
    },
    {
      name: "open zero",
      status: "open",
      stage: 801,
      amount: 0,
      probability: 0,
    },
    { name: "won", status: "won", stage: 803, amount: 12345, probability: 100 },
    {
      name: "lost zero",
      status: "lost",
      stage: 804,
      amount: 0,
      probability: 0,
    },
  ] as const)(
    "$name retains its complete state and prior history",
    async (variant) => {
      const original = await makeDeal({
        status: variant.status,
        stageId: demoId(variant.stage),
        amountMinor: variant.amount,
        probability: variant.probability,
        currency: "KWD",
        closedAt:
          variant.status === "open"
            ? null
            : new Date("2020-02-01T04:30:00.000Z"),
        lostReason:
          variant.status === "lost" ? "Fictional budget deferred." : "",
      });
      const [prior] = await local.db
        .insert(s.changeEvents)
        .values({
          ...scope,
          actorId: demoUser,
          type: `opportunity.${variant.status === "open" ? "updated" : variant.status}`,
          entityId: original.id,
          createdAt: new Date("2020-02-01T04:30:00.000Z"),
        })
        .returning();
      const removed = await archive(original, true);
      expect(removed.archivedAt).toBeInstanceOf(Date);
      expect(removed.version).toBe(original.version + 1);
      expect(retainedState(removed)).toEqual(retainedState(original));
      expect(await deal(original.id)).toEqual(removed);
      expect(await events(original.id)).toContainEqual(prior);
      const restored = await archive(removed, false);
      expect(restored.archivedAt).toBeNull();
      expect(restored.version).toBe(original.version + 2);
      expect(retainedState(restored)).toEqual(retainedState(original));
      expect(await deal(original.id)).toEqual(restored);
      const history = await events(original.id);
      expect(history).toHaveLength(3);
      expect(history).toContainEqual(prior);
      expect(history.filter((event) => event.id !== prior.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ...scope,
            actorId: demoUser,
            entityId: original.id,
            type: "opportunity.archived",
          }),
          expect.objectContaining({
            ...scope,
            actorId: demoUser,
            entityId: original.id,
            type: "opportunity.restored",
          }),
        ]),
      );
    },
  );

  test("same-state requests keep the version and history; stale removal and Undo fail", async () => {
    const original = await makeDeal();
    expect(
      opportunityRemovalSchema.parse(archiveInput(original, true)),
    ).toEqual({
      ...scope,
      opportunityId: original.id,
      version: original.version,
    });
    expect(
      opportunityRestoreSchema.safeParse({
        ...scope,
        opportunityId: original.id,
      }).success,
    ).toBe(false);
    expect(await archive(original, false)).toEqual(original);
    expect(await events(original.id)).toEqual([]);
    const removed = await archive(original, true);
    const removedHistory = await events(original.id);
    expect(await archive(removed, true)).toEqual(removed);
    expect(await events(original.id)).toEqual(removedHistory);
    for (const archived of [true, false])
      await expect(archive(original, archived)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    expect(await deal(original.id)).toEqual(removed);
    expect(await events(original.id)).toEqual(removedHistory);
    const restored = await archive(removed, false);
    const restoredHistory = await events(original.id);
    expect(await archive(restored, false)).toEqual(restored);
    expect(await events(original.id)).toEqual(restoredHistory);
    await expect(archive(removed, false)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  test("removal and restore leave the contact's work, approvals, history and files intact", async () => {
    const original = await makeDeal({ relationshipId: demoId(304) });
    const surrounding = () =>
      Promise.all([
        local.db.select().from(s.people),
        local.db.select().from(s.relationships),
        local.db.select().from(s.actions),
        local.db.select().from(s.enrollments),
        local.db.select().from(s.touches),
        local.db.select().from(s.conversations),
        local.db.select().from(s.messages),
        local.db.select().from(s.assets),
        local.db.select().from(s.deliveries),
      ]);
    const before = await surrounding();
    const removed = await archive(original, true);
    expect(await surrounding()).toEqual(before);
    await archive(removed, false);
    expect(await surrounding()).toEqual(before);
  });

  test("every deal editor rejects archived rows, including an unchanged lightweight edit", async () => {
    const removed = await archive(await makeDeal(), true);
    const history = await events(removed.id);
    for (const changes of [
      { name: removed.name },
      { name: "Fictional unwanted edit" },
      { stageId: demoId(803) },
    ])
      await expect(
        records.changeOpportunity(
          admin,
          opportunityChangeSchema.parse({
            ...scope,
            opportunityId: removed.id,
            version: removed.version,
            ...changes,
          }),
        ),
      ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    await expect(
      crm.saveOpportunity(admin, saveInput(removed)),
    ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    await expect(
      new RecordMetadataService(local.db).save(
        admin,
        recordMetadataSchema.parse({
          ...scope,
          entity: "opportunity",
          recordId: removed.id,
          version: removed.version,
          tags: ["Changed"],
          amountMinor: 999,
          currency: "USD",
        }),
      ),
    ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    expect(await deal(removed.id)).toEqual(removed);
    expect(await events(removed.id)).toEqual(history);
  });

  test("active context, SQL pages and reports exclude removed duplicates and recover on restore", async () => {
    const recent = new Date(Date.now() - 86400000);
    const active = await makeDeal({
      name: "Fictional archive report active",
      amountMinor: 20000,
      probability: 25,
    });
    const removedOpen = await archive(
      await makeDeal({
        name: "Fictional archive report removed",
        amountMinor: 40000,
        probability: 50,
      }),
      true,
    );
    await makeDeal({
      status: "won",
      stageId: demoId(803),
      amountMinor: 5000,
      probability: 100,
      closedAt: recent,
    });
    await makeDeal({
      status: "lost",
      stageId: demoId(804),
      amountMinor: 1000,
      probability: 0,
      closedAt: recent,
    });
    const removedWon = await archive(
      await makeDeal({
        status: "won",
        stageId: demoId(803),
        amountMinor: 9000,
        probability: 100,
        closedAt: recent,
      }),
      true,
    );
    const removedLost = await archive(
      await makeDeal({
        status: "lost",
        stageId: demoId(804),
        closedAt: recent,
      }),
      true,
    );
    const removedIds = new Set([removedOpen.id, removedWon.id, removedLost.id]);
    const snapshot = await crm.snapshot(admin, scope);
    expect(snapshot.opportunities.some((row) => removedIds.has(row.id))).toBe(
      false,
    );
    expect(snapshot.archivedOpportunities.map((row) => row.id).sort()).toEqual(
      [...removedIds].sort(),
    );
    expect(
      (
        await crm.context(admin, organizationId, relationshipId)
      ).opportunities.some((row) => removedIds.has(row.id)),
    ).toBe(false);
    expect(
      (
        await crm.personContext(admin, organizationId, demoId(200))
      ).opportunities.some((row) => removedIds.has(row.id)),
    ).toBe(false);
    expect(
      (await crm.companyContext(admin, scope, demoId(100))).opportunities.some(
        (row) => removedIds.has(row.id),
      ),
    ).toBe(false);
    const list = new RecordListService(local.db);
    const pageInput = recordListSchema.parse({
      ...scope,
      entity: "opportunities",
      query: "Fictional archive report",
      tag: "Duplicate",
      currency: "USD",
      minimum: 0,
      maximum: 100000,
      limit: 1,
    });
    const page = await list.page(admin, pageInput);
    expect(page.items.map((row) => row.id)).toEqual([active.id]);
    expect(page.total).toBe(1);
    expect(page.nextOffset).toBeNull();
    const report = await crm.overview(admin, { ...scope, days: 30 });
    expect(report.deals.some((row) => removedIds.has(row.id))).toBe(false);
    expect(report.pipelineValue).toEqual([
      { currency: "USD", amountMinor: 20000, count: 1 },
    ]);
    expect(report.weightedValue).toEqual([
      { currency: "USD", amountMinor: 5000, count: 1 },
    ]);
    expect(report.wonValue).toEqual([
      { currency: "USD", amountMinor: 5000, count: 1 },
    ]);
    expect(report.closed).toHaveLength(2);
    expect(report.winRate).toBe(50);
    const reader: Principal = {
      ...admin,
      source: "mcp",
      readOnly: true,
      organizationId,
      productIds: [productId],
    };
    expect((await crm.snapshot(reader, scope)).archivedOpportunities).toEqual(
      [],
    );
    const writer = { ...reader, readOnly: false };
    expect(
      (await crm.snapshot(writer, scope)).archivedOpportunities
        .map((row) => row.id)
        .sort(),
    ).toEqual([...removedIds].sort());
    expect(
      productSnapshot(serialize(snapshot), demoId(11)).archivedOpportunities,
    ).toEqual([]);
    await archive(removedOpen, false);
    const restoredPage = await list.page(admin, pageInput);
    expect(restoredPage.total).toBe(2);
    expect(restoredPage.nextOffset).toBe(1);
    const next = await list.page(admin, { ...pageInput, offset: 1 });
    expect(
      [...restoredPage.items, ...next.items].map((row) => row.id).sort(),
    ).toEqual([active.id, removedOpen.id].sort());
    expect(
      (
        await crm.context(admin, organizationId, relationshipId)
      ).opportunities.map((row) => row.id),
    ).toContain(removedOpen.id);
    expect(
      (await crm.overview(admin, { ...scope, days: 30 })).weightedValue,
    ).toEqual([{ currency: "USD", amountMinor: 25000, count: 2 }]);
  });
});

describe("stage changes preserve removed deals", () => {
  test("recategorization only changes active deals; restoring keeps the saved outcome", async () => {
    const removed = await archive(await makeDeal(), true);
    const active = await makeDeal();
    const history = await events(removed.id);
    await new PipelineService(local.db).updateStage(admin, {
      ...scope,
      stageId: demoId(801),
      category: "won",
    });
    expect(await deal(removed.id)).toEqual(removed);
    expect(await events(removed.id)).toEqual(history);
    expect(await deal(active.id)).toMatchObject({
      status: "won",
      probability: 100,
      version: active.version + 1,
    });
    await expect(archive(removed, false)).rejects.toMatchObject({
      code: "STAGE_REQUIRED",
    });
    for (const stageId of [demoId(803), demoId(811), demoId(1203)])
      await expect(archive(removed, false, { stageId })).rejects.toMatchObject({
        code: "STAGE_REQUIRED",
      });
    expect(await events(removed.id)).toEqual(history);
    const restored = await archive(removed, false, { stageId: demoId(802) });
    expect(retainedState(restored)).toEqual({
      ...retainedState(removed),
      stageId: demoId(802),
    });
    expect(restored.archivedAt).toBeNull();
    expect(restored.version).toBe(removed.version + 1);
  });

  test("stage retirement leaves removed won deals intact and requires a compatible active replacement", async () => {
    const original = await makeDeal({
      status: "won",
      stageId: demoId(803),
      probability: 100,
      closedAt: new Date("2020-02-01T04:30:00.000Z"),
    });
    const removed = await archive(original, true);
    const active = await makeDeal({
      status: "won",
      stageId: demoId(803),
      probability: 100,
      closedAt: original.closedAt,
    });
    const history = await events(removed.id);
    const pipelines = new PipelineService(local.db);
    const retired = await pipelines.archiveStage(admin, {
      ...scope,
      stageId: original.stageId,
      moveToStageId: demoId(804),
    });
    expect(retired.moved).toBe(1);
    expect(await deal(removed.id)).toEqual(removed);
    expect(await events(removed.id)).toEqual(history);
    expect(await deal(active.id)).toMatchObject({
      stageId: demoId(804),
      status: "lost",
      probability: 0,
      version: active.version + 1,
    });
    for (const stageId of [undefined, demoId(804), demoId(813)])
      await expect(archive(removed, false, { stageId })).rejects.toMatchObject({
        code: "STAGE_REQUIRED",
      });
    const replacement = await pipelines.createStage(admin, {
      ...scope,
      pipeline: "deal",
      pipelineId: demoId(1210),
      name: "Fictional replacement won",
      category: "won",
    });
    const restored = await archive(removed, false, { stageId: replacement.id });
    expect(retainedState(restored)).toEqual({
      ...retainedState(original),
      stageId: replacement.id,
    });
    expect(restored.version).toBe(removed.version + 1);
    expect(await events(removed.id)).toEqual(
      expect.arrayContaining([
        ...history,
        expect.objectContaining({ type: "opportunity.restored" }),
      ]),
    );
  });
});

describe("current tenant and product authorization", () => {
  test("wrong tenant, product scope, grant and read-only actors cannot remove or restore", async () => {
    const original = await makeDeal();
    const foreign = await makeDeal({
      organizationId: demoId(2),
      productId: demoId(13),
      relationshipId: demoId(307),
      stageId: demoId(831),
    });
    for (const archived of [true, false]) {
      const row = archived ? original : await archive(original, true);
      const requests: [Principal, Partial<ArchiveInput>, string][] = [
        [admin, { productId: demoId(11) }, "FORBIDDEN"],
        [
          admin,
          { organizationId: demoId(2), productId: demoId(13) },
          "NOT_FOUND",
        ],
        [admin, { opportunityId: foreign.id }, "NOT_FOUND"],
        [{ userId: "fictional-nonmember", source: "session" }, {}, "FORBIDDEN"],
        [{ userId: "demo-restricted", source: "session" }, {}, "FORBIDDEN"],
        [
          { ...admin, source: "mcp", readOnly: true, organizationId },
          {},
          "HUMAN_ACTION_REQUIRED",
        ],
        [
          { ...admin, source: "mcp", organizationId },
          {},
          "HUMAN_ACTION_REQUIRED",
        ],
        [
          {
            ...admin,
            source: "mcp",
            readOnly: false,
            organizationId,
            productIds: [demoId(11)],
          },
          {},
          "FORBIDDEN",
        ],
        [
          {
            ...admin,
            source: "mcp",
            readOnly: false,
            organizationId: demoId(2),
          },
          {},
          "FORBIDDEN",
        ],
      ];
      const history = await events(row.id);
      for (const [principal, changes, code] of requests)
        await expect(
          records.archiveOpportunity(
            principal,
            archiveInput(row, archived, changes),
          ),
        ).rejects.toMatchObject({ code });
      expect(await deal(row.id)).toEqual(row);
      expect(await events(row.id)).toEqual(history);
    }
    expect(await deal(foreign.id)).toEqual(foreign);
  });

  test.each(["membership", "product grant"] as const)(
    "current %s is required for restoration",
    async (revoked) => {
      const removed = await archive(await makeDeal(), true);
      if (revoked === "membership")
        await local.db
          .update(s.memberships)
          .set({ active: false })
          .where(
            and(
              eq(s.memberships.organizationId, organizationId),
              eq(s.memberships.userId, teammate.userId),
            ),
          );
      else
        await local.db
          .delete(s.productMemberships)
          .where(
            and(
              eq(s.productMemberships.organizationId, organizationId),
              eq(s.productMemberships.productId, productId),
              eq(s.productMemberships.userId, teammate.userId),
            ),
          );
      await expect(
        records.archiveOpportunity(teammate, archiveInput(removed, false)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await deal(removed.id)).toEqual(removed);
      expect((await events(removed.id)).map((row) => row.type)).toEqual([
        "opportunity.archived",
      ]);
    },
  );

  test.each(["membership", "product grant"] as const)(
    "deal creation, edits, removal and restore recheck %s after the organization lock wait",
    async (revoked) => {
      const original = await makeDeal();
      const removed = await archive(await makeDeal(), true);
      for (const operation of [
        "create",
        "change",
        "archive",
        "restore",
      ] as const) {
        const before = await local.db
          .select()
          .from(s.opportunities)
          .orderBy(s.opportunities.id);
        const beforeEvents = await local.db
          .select()
          .from(s.changeEvents)
          .orderBy(s.changeEvents.id);
        const replay = databaseWithLockInterleave(local.db, async (tx, sql) => {
          expect(sql).toContain('"organizations"');
          if (revoked === "membership")
            await tx
              .update(s.memberships)
              .set({ active: false })
              .where(
                and(
                  eq(s.memberships.organizationId, organizationId),
                  eq(s.memberships.userId, teammate.userId),
                ),
              );
          else
            await tx
              .delete(s.productMemberships)
              .where(
                and(
                  eq(s.productMemberships.organizationId, organizationId),
                  eq(s.productMemberships.productId, productId),
                  eq(s.productMemberships.userId, teammate.userId),
                ),
              );
        });
        const service = new RecordService(replay.database);
        const action =
          operation === "create"
            ? service.createOpportunity(
                teammate,
                opportunityCreateSchema.parse({
                  ...scope,
                  relationshipId,
                  stageId: demoId(801),
                  name: "Fictional denied creation",
                }),
              )
            : operation === "change"
              ? service.changeOpportunity(
                  teammate,
                  opportunityChangeSchema.parse({
                    ...scope,
                    opportunityId: original.id,
                    version: original.version,
                    name: "Fictional denied edit",
                  }),
                )
              : service.archiveOpportunity(
                  teammate,
                  archiveInput(
                    operation === "archive" ? original : removed,
                    operation === "archive",
                  ),
                );
        await expect(action).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(replay.didInterleave()).toBe(true);
        expect(
          await local.db
            .select()
            .from(s.opportunities)
            .orderBy(s.opportunities.id),
        ).toEqual(before);
        expect(
          await local.db
            .select()
            .from(s.changeEvents)
            .orderBy(s.changeEvents.id),
        ).toEqual(beforeEvents);
      }
    },
  );

  test.each(["contact", "product"] as const)(
    "an archived %s prevents restoration without changing deal state",
    async (parent) => {
      const removed = await archive(await makeDeal(), true);
      const history = await events(removed.id);
      if (parent === "contact")
        await local.db
          .update(s.people)
          .set({ archivedAt: new Date() })
          .where(eq(s.people.id, demoId(200)));
      else
        await local.db
          .update(s.products)
          .set({ archivedAt: new Date() })
          .where(eq(s.products.id, productId));
      await expect(archive(removed, false)).rejects.toMatchObject({
        code: parent === "contact" ? "RECORD_ARCHIVED" : "PRODUCT_ARCHIVED",
      });
      expect(await deal(removed.id)).toEqual(removed);
      expect(await events(removed.id)).toEqual(history);
    },
  );
});
