import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { operations } from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const admin: Principal = { userId: demoUser, source: "demo" };
const restricted: Principal = { userId: "demo-restricted", source: "session" };

beforeEach(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterEach(async () => {
  await local.client.close();
});

async function change(
  principal: Principal,
  relationshipId: string,
  input: Record<string, unknown>,
) {
  const operation = operations.find(
    (item) => item.name === "change_relationship",
  );
  if (!operation) throw new Error("MISSING_OPERATION");
  const [relationship] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, relationshipId));
  return (await operation.execute(
    { db: local.db, principal },
    {
      organizationId: org,
      relationshipId,
      version: relationship?.version,
      ...input,
    },
  )) as typeof s.relationships.$inferSelect;
}
const touchesOf = (relationshipId: string) =>
  local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.relationshipId, relationshipId));

test("transferring a relationship moves its open touches to the new sender and clears their approval", async () => {
  const before = await touchesOf(demoId(304));
  const approved = before.find((touch) => touch.status === "approved");
  const sent = before.find((touch) => touch.status === "sent");
  expect(approved?.senderId).toBe(demoUser);
  expect(sent).toBeTruthy();
  const updated = await change(admin, demoId(304), {
    ownerId: "demo-teammate",
  });
  expect(updated.ownerId).toBe("demo-teammate");
  const after = await touchesOf(demoId(304));
  const moved = after.find((touch) => touch.id === approved?.id);
  expect(moved).toMatchObject({
    senderId: "demo-teammate",
    status: "drafted",
    approvedHash: null,
    approvedBy: null,
    version: (approved?.version ?? 0) + 1,
  });
  expect(after.find((touch) => touch.id === sent?.id)?.senderId).toBe(
    sent?.senderId,
  );
  const events = await local.db
    .select()
    .from(s.changeEvents)
    .where(
      and(
        eq(s.changeEvents.organizationId, org),
        inArray(s.changeEvents.entityId, [demoId(304), approved?.id ?? ""]),
      ),
    );
  expect(events.map((event) => event.type).sort()).toEqual([
    "relationship.owner_changed",
    "touch.approval_invalidated",
    "touch.sender_changed",
  ]);
});

test("planned and drafted touches follow the new owner", async () => {
  await change(admin, demoId(300), { ownerId: "demo-teammate" });
  const after = await touchesOf(demoId(300));
  const open = after.filter((touch) =>
    ["planned", "drafted"].includes(touch.status),
  );
  expect(open.length).toBeGreaterThan(0);
  for (const touch of open) expect(touch.senderId).toBe("demo-teammate");
  for (const touch of after.filter((touch) => touch.status === "sent"))
    expect(touch.senderId).toBe(demoUser);
});

test("the new owner must be an active member with access to the product", async () => {
  await expect(
    change(admin, demoId(304), { ownerId: "demo-restricted" }),
  ).rejects.toMatchObject({ code: "OWNER_NOT_ALLOWED" });
  await local.db
    .update(s.memberships)
    .set({ active: false })
    .where(eq(s.memberships.userId, "demo-teammate"));
  await expect(
    change(admin, demoId(304), { ownerId: "demo-teammate" }),
  ).rejects.toMatchObject({ code: "OWNER_NOT_ALLOWED" });
  const [relationship] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, demoId(304)));
  expect(relationship?.ownerId).toBe(demoUser);
});

test("transferring ownership requires write access to the relationship's product", async () => {
  await expect(
    change(restricted, demoId(304), { ownerId: "demo-restricted" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
