import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ActionDetailsService } from "../packages/core/action-details";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import {
  createLocalDatabase,
  type Database,
} from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  apiOperation,
  executeMcpOperation,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const admin: Principal = { userId: demoUser, source: "session" };
const writer: Principal = {
  ...admin,
  source: "mcp",
  organizationId: demoId(1),
  productIds: [demoId(12)],
  readOnly: false,
};
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => {
  await local.client.close();
});

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
// PGlite has one connection. Replay the other writer's committed change at a
// lock wait inside this transaction so the interleaving is deterministic.
function databaseWithLockInterleave(
  table: "people" | "organizations",
  interleave: (tx: Transaction) => Promise<void>,
) {
  let interleaved = false;
  const locks: string[] = [];
  const database = new Proxy(local.db, {
    get(db, property, receiver) {
      if (property !== "transaction")
        return Reflect.get(db, property, receiver);
      return (run: Parameters<Database["transaction"]>[0]) =>
        db.transaction(async (tx) => {
          const wrapQuery = (query: object): object =>
            new Proxy(query, {
              get(builder, key, builderReceiver) {
                const member = Reflect.get(builder, key, builderReceiver);
                if (typeof member !== "function") return member;
                return (...args: unknown[]) => {
                  const result: unknown = Reflect.apply(member, builder, args);
                  if (key === "for") {
                    const { sql } = Reflect.apply(
                      Reflect.get(builder, "toSQL"),
                      builder,
                      [],
                    ) as { sql: string };
                    locks.push(sql);
                    if (!interleaved && sql.includes(`"${table}"`)) {
                      interleaved = true;
                      return (async () => {
                        await interleave(tx);
                        return await (result as PromiseLike<unknown>);
                      })();
                    }
                  }
                  return result !== null && typeof result === "object"
                    ? wrapQuery(result)
                    : result;
                };
              },
            });
          const intercepted = new Proxy(tx, {
            get(target, key, targetReceiver) {
              const member = Reflect.get(target, key, targetReceiver);
              if (key === "select")
                return (...args: unknown[]) =>
                  wrapQuery(Reflect.apply(member, target, args) as object);
              return typeof member === "function"
                ? member.bind(target)
                : member;
            },
          });
          return run(intercepted);
        });
    },
  });
  return { database, locks, didInterleave: () => interleaved };
}

test("HTTP and MCP edit a legacy reason, preserve source, invalidate approval and reject stale versions", async () => {
  const original =
    '{"context":"Fictional imported reason","send_permission":true}';
  await local.db
    .update(s.actions)
    .set({ reason: original })
    .where(eq(s.actions.id, demoId(602)));
  const approved = await new CrmService(local.db).changeAction(admin, {
    organizationId: demoId(1),
    actionId: demoId(602),
    version: 1,
    command: "approve",
  });
  const operation = apiOperation("crm", "POST", "action-details");
  const changed = await operation.execute(
    { db: local.db, principal: admin },
    {
      organizationId: demoId(1),
      productId: demoId(12),
      actionId: approved.id,
      version: approved.version,
      reason: "Prepare the promised fictional proposal.",
    },
  );
  expect(changed).toMatchObject({
    reasonSource: original,
    version: 3,
    approvedHash: null,
    approvedBy: null,
    status: "open",
  });
  const mcp = operations.find((item) => item.name === "update_action_reason");
  if (!mcp) throw new Error("MCP operation missing");
  const input = {
    productId: demoId(12),
    actionId: approved.id,
    version: 3,
    reason: "Clarified fictional notes.",
  };
  const saved = await executeMcpOperation(
    mcp,
    { db: local.db, principal: writer },
    demoId(1),
    input,
  );
  expect(saved).toMatchObject({
    reason: input.reason,
    reasonSource: original,
    version: 4,
  });
  await expect(
    executeMcpOperation(
      mcp,
      { db: local.db, principal: writer },
      demoId(1),
      input,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    executeMcpOperation(
      mcp,
      { db: local.db, principal: { ...writer, readOnly: true } },
      demoId(1),
      { ...input, version: 4 },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await local.db.select().from(s.deliveries)).toHaveLength(0);
  expect(await local.db.select().from(s.messages)).toHaveLength(3);
});

test("reason edits preserve blocked/completed states and private/product/organization access", async () => {
  const service = new ActionDetailsService(local.db);
  await local.db
    .update(s.conversations)
    .set({ visibility: "private" })
    .where(eq(s.conversations.id, demoId(710)));
  await local.db
    .update(s.actions)
    .set({ sourceConversationId: demoId(710) })
    .where(eq(s.actions.id, demoId(600)));
  const blocked = {
    organizationId: demoId(1),
    actionId: demoId(600),
    version: 1,
    reason: "Reviewed fictional reason.",
  };
  await expect(
    service.save({ userId: "demo-teammate", source: "session" }, blocked),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    service.save({ ...writer, productIds: [demoId(11)] }, blocked),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    service.save(admin, { ...blocked, organizationId: demoId(2) }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await service.save(admin, blocked)).toMatchObject({
    status: "blocked",
    kind: "approval",
    version: 2,
  });
  await local.db
    .update(s.actions)
    .set({ status: "completed" })
    .where(eq(s.actions.id, demoId(602)));
  expect(
    await service.save(admin, {
      organizationId: demoId(1),
      actionId: demoId(602),
      version: 4,
      reason: "Corrected after completion.",
    }),
  ).toMatchObject({ status: "completed", version: 5 });
  const compact = await new CrmService(local.db).snapshot(
    admin,
    { organizationId: demoId(1) },
    true,
  );
  expect(
    compact.actions.find((action) => action.id === demoId(602)),
  ).toMatchObject({ reason: "", reasonSource: null });
});

test("sharing revoked while a reason edit waits for contact locks prevents the edit and source disclosure", async () => {
  const [template] = await local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, demoId(600)));
  const [action] = await local.db
    .insert(s.actions)
    .values({
      ...template,
      id: demoId(8990),
      reason: '{"context":"Fictional private source"}',
      reasonSource: null,
      approvedHash: null,
      approvedBy: null,
      version: 1,
    })
    .returning();
  await local.db
    .update(s.conversations)
    .set({ visibility: "product" })
    .where(eq(s.conversations.id, demoId(710)));
  const replay = databaseWithLockInterleave("people", async (tx) => {
    await tx
      .update(s.conversations)
      .set({ visibility: "private" })
      .where(eq(s.conversations.id, demoId(710)));
  });
  try {
    await expect(
      new ActionDetailsService(replay.database).save(
        { userId: "demo-teammate", source: "session" },
        {
          organizationId: demoId(1),
          actionId: action.id,
          version: 1,
          reason: "Fictional edited notes.",
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(replay.didInterleave()).toBe(true);
    const contactLock = replay.locks.findIndex((sql) =>
      sql.includes('from "people"'),
    );
    const sourceLock = replay.locks.findIndex((sql) =>
      sql.includes('from "conversations"'),
    );
    expect(contactLock).toBeGreaterThanOrEqual(0);
    expect(sourceLock).toBeGreaterThan(contactLock);
    expect(replay.locks[sourceLock]).toMatch(/for share$/);
    expect(
      await local.db
        .select()
        .from(s.actions)
        .where(eq(s.actions.id, action.id)),
    ).toEqual([action]);
    expect(
      await local.db
        .select()
        .from(s.changeEvents)
        .where(eq(s.changeEvents.entityId, action.id)),
    ).toHaveLength(0);
  } finally {
    await local.db
      .update(s.conversations)
      .set({ visibility: "private" })
      .where(eq(s.conversations.id, demoId(710)));
  }
});

test("reason editing rechecks current membership and product grants after a directory lock wait", async () => {
  const [template] = await local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, demoId(600)));
  const [action] = await local.db
    .insert(s.actions)
    .values({
      ...template,
      id: demoId(8991),
      sourceConversationId: null,
      approvedHash: null,
      approvedBy: null,
      version: 1,
    })
    .returning();
  for (const revoked of ["membership", "product"] as const) {
    const replay = databaseWithLockInterleave("organizations", async (tx) => {
      if (revoked === "membership")
        await tx
          .update(s.memberships)
          .set({ active: false })
          .where(
            and(
              eq(s.memberships.organizationId, demoId(1)),
              eq(s.memberships.userId, "demo-teammate"),
            ),
          );
      else
        await tx
          .delete(s.productMemberships)
          .where(
            and(
              eq(s.productMemberships.organizationId, demoId(1)),
              eq(s.productMemberships.productId, demoId(10)),
              eq(s.productMemberships.userId, "demo-teammate"),
            ),
          );
    });
    await expect(
      new ActionDetailsService(replay.database).save(
        { userId: "demo-teammate", source: "session" },
        {
          organizationId: demoId(1),
          actionId: action.id,
          version: 1,
          reason: "Fictional access-revoked edit.",
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(replay.didInterleave()).toBe(true);
    expect(
      await local.db
        .select()
        .from(s.actions)
        .where(eq(s.actions.id, action.id)),
    ).toEqual([action]);
  }
});
