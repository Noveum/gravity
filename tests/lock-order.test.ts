import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { errorResponse } from "../packages/core/http";
import { assertProductAccess, MemberService } from "../packages/core/members";
import { OutreachService } from "../packages/core/outreach";
import type { Principal } from "../packages/core/policy";
import { RecordService } from "../packages/core/records";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

const queries: string[] = [];
const client = new PGlite();
const db = drizzle(client, {
  schema: s,
  logger: { logQuery: (query) => queries.push(query) },
});
const admin: Principal = { userId: demoUser, source: "demo" };
const org = demoId(1);
beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  await seedDemo(db);
});
afterAll(async () => client.close());
beforeEach(() => {
  queries.length = 0;
});
const position = (pattern: RegExp) =>
  queries.findIndex((query) => pattern.test(query));

test("moving a deal share-locks the target stage before the deal row", async () => {
  const [deal] = await db
    .select()
    .from(s.opportunities)
    .where(eq(s.opportunities.id, demoId(1101)));
  const [target] = await db
    .select()
    .from(s.stages)
    .where(
      and(
        eq(s.stages.productId, deal.productId),
        eq(s.stages.pipeline, "deal"),
        ne(s.stages.id, deal.stageId),
      ),
    );
  queries.length = 0;
  await new RecordService(db).changeOpportunity(admin, {
    organizationId: org,
    opportunityId: deal.id,
    version: deal.version,
    stageId: target.id,
  });
  const stageLock = position(/from "stages".*for share/is);
  const dealLock = position(/from "opportunities".*for update/is);
  expect(stageLock).toBeGreaterThanOrEqual(0);
  expect(stageLock).toBeLessThan(dealLock);
});

test("moving a relationship share-locks the target stage before the relationship row", async () => {
  const [relationship] = await db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, demoId(300)));
  const [target] = await db
    .select()
    .from(s.stages)
    .where(
      and(
        eq(s.stages.productId, relationship.productId),
        eq(s.stages.pipeline, "outreach"),
        ne(s.stages.id, relationship.stageId ?? ""),
      ),
    );
  queries.length = 0;
  await new OutreachService(db).changeRelationship(admin, {
    organizationId: org,
    relationshipId: relationship.id,
    version: relationship.version,
    stageId: target.id,
  });
  const stageLock = position(/from "stages".*for share/is);
  const rowLock = position(/from "relationships".*for update/is);
  expect(stageLock).toBeGreaterThanOrEqual(0);
  expect(stageLock).toBeLessThan(rowLock);
});

test("deadlocks and serialization failures surface as a retryable conflict", async () => {
  for (const code of ["40P01", "40001"]) {
    const response = errorResponse(
      Object.assign(new Error("database"), { code }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "CONFLICT",
      retryable: true,
    });
  }
  const wrapped = errorResponse(
    Object.assign(new Error("wrapped"), {
      cause: Object.assign(new Error("database"), { code: "40P01" }),
    }),
  );
  expect(wrapped.status).toBe(409);
  expect(errorResponse(new Error("other")).status).toBe(500);
});

test("member administration locks memberships in id order", async () => {
  await new MemberService(db).changeRole(admin, {
    organizationId: org,
    userId: demoUser,
    role: "admin",
  });
  expect(
    queries.find((query) =>
      /from "memberships".*order by "memberships"\."id".*for update/is.test(
        query,
      ),
    ),
  ).toBeTruthy();
});

test("checking a new owner's product access share-locks their membership", async () => {
  await assertProductAccess(db, org, demoUser, [demoId(10)]);
  expect(
    queries.some((query) =>
      /from "memberships".*"user_id" = .*for share/is.test(query),
    ),
  ).toBe(true);
});
