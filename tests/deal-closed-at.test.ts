import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { operations } from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const admin: Principal = { userId: demoUser, source: "session" };
const dealId = demoId(1101);
const earlier = new Date("2026-01-15T00:00:00Z");

beforeEach(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterEach(async () => {
  await local.client.close();
});

async function run<T = Record<string, unknown>>(
  name: string,
  input: Record<string, unknown>,
) {
  const operation = operations.find((item) => item.name === name);
  if (!operation) throw new Error(`MISSING_OPERATION:${name}`);
  return (await operation.execute(
    { db: local.db, principal: admin },
    { organizationId: org, ...input },
  )) as T;
}
async function deal() {
  const [row] = await local.db
    .select()
    .from(s.opportunities)
    .where(eq(s.opportunities.id, dealId));
  if (!row) throw new Error("deal fixture");
  return row;
}
async function wonStages() {
  const [existing] = await local.db
    .select()
    .from(s.stages)
    .where(
      and(
        eq(s.stages.productId, demoId(10)),
        eq(s.stages.pipeline, "deal"),
        eq(s.stages.category, "won"),
      ),
    );
  if (!existing) throw new Error("won stage fixture");
  const second = await run<{ id: string }>("create_stage", {
    productId: demoId(10),
    pipeline: "deal",
    ...(existing.pipelineId ? { pipelineId: existing.pipelineId } : {}),
    name: "Won again",
    category: "won",
  });
  return [existing.id, second.id] as const;
}
async function legacyWon(stageId: string, closedAt: Date | null = null) {
  await local.db
    .update(s.opportunities)
    .set({ status: "won", stageId, closedAt, probability: 100 })
    .where(eq(s.opportunities.id, dealId));
  return deal();
}

test("moving a legacy won deal between won stages gives it a close time and keeps an existing one", async () => {
  const [first, second] = await wonStages();
  const legacy = await legacyWon(first);
  await run("change_opportunity", {
    opportunityId: dealId,
    version: legacy.version,
    stageId: second,
  });
  expect((await deal()).closedAt).not.toBeNull();
  const dated = await legacyWon(second, earlier);
  await run("change_opportunity", {
    opportunityId: dealId,
    version: dated.version,
    stageId: first,
  });
  expect((await deal()).closedAt).toEqual(earlier);
});

test("saving a closed deal without changing its status keeps or fills its close time", async () => {
  const [first] = await wonStages();
  const save = (row: typeof s.opportunities.$inferSelect) =>
    run("save_deal", {
      id: row.id,
      version: row.version,
      productId: row.productId,
      relationshipId: row.relationshipId,
      stageId: row.stageId,
      name: "Renamed while won",
      ownerId: demoUser,
      currency: "USD",
      status: "won",
    });
  await save(await legacyWon(first));
  expect((await deal()).closedAt).not.toBeNull();
  await save(await legacyWon(first, earlier));
  expect((await deal()).closedAt).toEqual(earlier);
});

test("archiving a won stage into another won stage never leaves a close time empty", async () => {
  const [first, second] = await wonStages();
  await legacyWon(second);
  await run("archive_stage", { stageId: second, moveToStageId: first });
  const moved = await deal();
  expect(moved.stageId).toBe(first);
  expect(moved.closedAt).not.toBeNull();
});

test("renaming a legacy lost deal fills its close time", async () => {
  await local.db
    .update(s.opportunities)
    .set({ status: "lost", closedAt: null, probability: 0 })
    .where(eq(s.opportunities.id, dealId));
  const legacy = await deal();
  await run("change_opportunity", {
    opportunityId: dealId,
    version: legacy.version,
    name: "Renamed while lost",
  });
  expect((await deal()).closedAt).not.toBeNull();
});
