import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { OutreachService } from "../packages/core/outreach";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const admin: Principal = { userId: demoUser, source: "demo" };

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => {
  await local.client.close();
});

test("the demo has outreach stages, staged relationships, a three follow-up sequence and touches in every status", async () => {
  const stages = await local.db.select().from(s.stages);
  const products = await local.db.select().from(s.products);
  for (const product of products)
    expect(
      stages.filter(
        (stage) =>
          stage.productId === product.id && stage.pipeline === "outreach",
      ),
    ).toHaveLength(9);
  const relationships = await local.db.select().from(s.relationships);
  expect(relationships.every((row) => row.stageId)).toBe(true);
  expect(new Set(relationships.map((row) => row.stageId)).size).toBeGreaterThan(
    5,
  );
  const [sequence] = await local.db
    .select()
    .from(s.sequences)
    .where(eq(s.sequences.id, demoId(400)));
  expect(sequence?.steps.map((step) => step.followUp)).toEqual([0, 1, 2, 3]);
  expect(sequence?.steps.every((step) => step.template.length > 0)).toBe(true);
  const touches = await local.db.select().from(s.touches);
  expect(new Set(touches.map((touch) => touch.status))).toEqual(
    new Set(["planned", "drafted", "approved", "sent", "skipped", "expired"]),
  );
  const [owen] = await local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, demoId(208)));
  expect(owen?.doNotContact).toBe(true);
});

test("the seeded outreach is already planned, so the first read changes nothing and lists today's touches", async () => {
  const outreach = new OutreachService(local.db);
  const due = await outreach.dueTouches(admin, { organizationId: demoId(1) });
  expect(due.advanced).toEqual({ created: 0, completed: 0, paused: 0 });
  const listed = due.groups.flatMap((group) =>
    group.touches.map((touch) => touch.id),
  );
  expect(listed).toEqual(
    expect.arrayContaining([demoId(1304), demoId(1307), demoId(1310)]),
  );
  expect(listed).not.toContain(demoId(1302));
});
