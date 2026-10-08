import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { CrmService, opportunitySchema } from "../packages/core/crm";
import { PipelineService } from "../packages/core/pipelines";
import type { Principal } from "../packages/core/policy";
import {
  RecordMetadataService,
  recordMetadataSchema,
} from "../packages/core/record-metadata";
import {
  opportunityArchiveSchema,
  opportunityChangeSchema,
  RecordService,
} from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { databaseWithLockInterleave } from "./support/lock-interleave";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let crm: CrmService;
let records: RecordService;
const org = demoId(1);
const product = demoId(10);
const relationship = demoId(300);
const admin: Principal = { userId: demoUser, source: "session" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  crm = new CrmService(local.db);
  records = new RecordService(local.db);
});
afterAll(async () => local.client.close());

async function createDeal(extra: Record<string, unknown> = {}) {
  return crm.saveOpportunity(
    admin,
    opportunitySchema.parse({
      organizationId: org,
      productId: product,
      relationshipId: relationship,
      stageId: demoId(800),
      name: `Fictional removal ${randomUUID()}`,
      ownerId: demoUser,
      amountMinor: 125000,
      currency: "USD",
      probability: 40,
      description: "Fictional deal notes retained during removal",
      expectedCloseDate: "2026-11-01",
      ...extra,
    }),
  );
}

function archiveInput(
  deal: typeof s.opportunities.$inferSelect,
  archived = true,
  extra: Record<string, unknown> = {},
) {
  return opportunityArchiveSchema.parse({
    organizationId: org,
    productId: deal.productId,
    opportunityId: deal.id,
    version: deal.version,
    archived,
    ...extra,
  });
}

async function dealEvents(id: string) {
  return local.db
    .select()
    .from(s.changeEvents)
    .where(eq(s.changeEvents.entityId, id));
}

async function storedDeal(id: string) {
  const [deal] = await local.db
    .select()
    .from(s.opportunities)
    .where(eq(s.opportunities.id, id));
  return deal;
}

test("removing a won deal preserves every historical field and linked private history", async () => {
  const deal = await createDeal({ stageId: demoId(803), status: "won" });
  const beforeEvents = await dealEvents(deal.id);
  const beforeContext = await crm.context(admin, org, relationship);
  const removed = await records.archiveOpportunity(admin, archiveInput(deal));
  expect(removed).toEqual({
    ...deal,
    archivedAt: expect.any(Date),
    version: deal.version + 1,
  });
  const afterEvents = await dealEvents(deal.id);
  expect(afterEvents).toEqual(expect.arrayContaining(beforeEvents));
  expect(afterEvents).toHaveLength(beforeEvents.length + 1);
  expect(afterEvents.at(-1)).toMatchObject({
    organizationId: org,
    productId: product,
    actorId: demoUser,
    type: "opportunity.archived",
  });
  const afterContext = await crm.context(admin, org, relationship);
  expect(afterContext.opportunities.map((row) => row.id)).not.toContain(
    deal.id,
  );
  for (const key of [
    "messages",
    "conversations",
    "evidence",
    "actions",
  ] as const)
    expect(afterContext[key]).toEqual(beforeContext[key]);
  expect(
    (await crm.overview(admin, { organizationId: org, days: 30 })).won.map(
      (row) => row.id,
    ),
  ).not.toContain(deal.id);
  const restored = await records.archiveOpportunity(
    admin,
    archiveInput(removed, false),
  );
  expect(restored).toEqual({ ...deal, version: deal.version + 2 });
});

test("archived deals reject full saves, partial edits, metadata edits and stale restore versions", async () => {
  const deal = await createDeal();
  const removed = await records.archiveOpportunity(admin, archiveInput(deal));
  await expect(
    crm.saveOpportunity(
      admin,
      opportunitySchema.parse({
        ...removed,
        name: "Fictional stale full save",
      }),
    ),
  ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
  await expect(
    records.changeOpportunity(
      admin,
      opportunityChangeSchema.parse({
        ...archiveInput(removed),
        name: "Fictional partial edit",
      }),
    ),
  ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
  await expect(
    new RecordMetadataService(local.db).save(
      admin,
      recordMetadataSchema.parse({
        organizationId: org,
        productId: product,
        entity: "opportunity",
        recordId: deal.id,
        version: removed.version,
        tags: ["Fictional"],
        amountMinor: 1,
        currency: "EUR",
      }),
    ),
  ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
  await expect(
    records.archiveOpportunity(admin, archiveInput(deal, false)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await storedDeal(deal.id)).toEqual(removed);
  const events = await dealEvents(deal.id);
  expect(
    await records.archiveOpportunity(admin, archiveInput(removed)),
  ).toEqual(removed);
  expect(await dealEvents(deal.id)).toEqual(events);
});

test("pipeline changes preserve archived outcomes and restoration requires a compatible active stage", async () => {
  const pipelines = new PipelineService(local.db);
  const stage = await pipelines.createStage(admin, {
    organizationId: org,
    productId: product,
    pipeline: "deal",
    pipelineId: demoId(1210),
    name: `Fictional retired ${randomUUID()}`,
    category: "open",
  });
  const deal = await createDeal({ stageId: stage.id });
  const removed = await records.archiveOpportunity(admin, archiveInput(deal));
  await pipelines.updateStage(admin, {
    organizationId: org,
    stageId: stage.id,
    category: "won",
  });
  expect(await storedDeal(deal.id)).toEqual(removed);
  await expect(
    records.archiveOpportunity(admin, archiveInput(removed, false)),
  ).rejects.toMatchObject({ code: "STAGE_REQUIRED" });
  await pipelines.archiveStage(admin, {
    organizationId: org,
    stageId: stage.id,
    moveToStageId: demoId(803),
  });
  expect(await storedDeal(deal.id)).toEqual(removed);
  await expect(
    records.archiveOpportunity(admin, archiveInput(removed, false)),
  ).rejects.toMatchObject({ code: "STAGE_REQUIRED" });
  await expect(
    records.archiveOpportunity(
      admin,
      archiveInput(removed, false, { stageId: demoId(810) }),
    ),
  ).rejects.toMatchObject({ code: "STAGE_REQUIRED" });
  const restored = await records.archiveOpportunity(
    admin,
    archiveInput(removed, false, { stageId: demoId(800) }),
  );
  expect(restored).toEqual({
    ...deal,
    stageId: demoId(800),
    version: removed.version + 1,
  });
});

test("won deals cannot be restored into an open stage", async () => {
  const deal = await createDeal({ stageId: demoId(803), status: "won" });
  const removed = await records.archiveOpportunity(admin, archiveInput(deal));
  await expect(
    records.archiveOpportunity(
      admin,
      archiveInput(removed, false, { stageId: demoId(800) }),
    ),
  ).rejects.toMatchObject({ code: "STAGE_REQUIRED" });
  expect(await storedDeal(deal.id)).toEqual(removed);
});

test.each([
  { userId: "demo-restricted", source: "session" },
  { userId: demoUser, source: "mcp", organizationId: org },
  {
    userId: demoUser,
    source: "mcp",
    organizationId: org,
    productIds: [demoId(11)],
    readOnly: false,
  },
] satisfies Principal[])(
  "deal removal preserves product and write grants for $userId/$source",
  async (principal) => {
    const deal = await createDeal();
    await expect(
      records.archiveOpportunity(principal, archiveInput(deal)),
    ).rejects.toMatchObject({ status: 403 });
    expect(await storedDeal(deal.id)).toEqual(deal);
    expect(await dealEvents(deal.id)).toHaveLength(1);
  },
);

test.each(["membership", "product grant"])(
  "deal removal refreshes %s revocation after its first lock wait",
  async (revoked) => {
    const deal = await createDeal({
      productId: demoId(11),
      relationshipId: demoId(301),
      stageId: demoId(810),
    });
    const race = databaseWithLockInterleave(local.db, async (tx, sql) => {
      expect(sql).toContain('"organizations"');
      if (revoked === "membership")
        await tx
          .update(s.memberships)
          .set({ active: false })
          .where(
            and(
              eq(s.memberships.organizationId, org),
              eq(s.memberships.userId, "demo-restricted"),
            ),
          );
      else
        await tx
          .delete(s.productMemberships)
          .where(
            and(
              eq(s.productMemberships.organizationId, org),
              eq(s.productMemberships.userId, "demo-restricted"),
              eq(s.productMemberships.productId, demoId(11)),
            ),
          );
    });
    await expect(
      new RecordService(race.database).archiveOpportunity(
        { userId: "demo-restricted", source: "session" },
        archiveInput(deal),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(race.didInterleave()).toBe(true);
    expect(await storedDeal(deal.id)).toEqual(deal);
    expect(await dealEvents(deal.id)).toHaveLength(1);
  },
);

test("legacy full deal saves refresh actor membership after a lock wait even when the selected owner remains authorized", async () => {
  const deal = await createDeal();
  const race = databaseWithLockInterleave(local.db, async (tx) => {
    await tx
      .update(s.memberships)
      .set({ active: false })
      .where(
        and(
          eq(s.memberships.organizationId, org),
          eq(s.memberships.userId, teammate.userId),
        ),
      );
  });
  await expect(
    new CrmService(race.database).saveOpportunity(
      teammate,
      opportunitySchema.parse({
        ...deal,
        name: "Fictional revoked actor edit",
      }),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(race.didInterleave()).toBe(true);
  expect(await storedDeal(deal.id)).toEqual(deal);
  expect(await dealEvents(deal.id)).toHaveLength(1);
});
