import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  operationRequirements,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const admin: Principal = { userId: demoUser, source: "session" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const adminAgent: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: org,
  readOnly: true,
};
const ids = {
  unknown: randomUUID(),
  sending: randomUUID(),
  accepted: randomUUID(),
  failed: randomUUID(),
  sent: randomUUID(),
  teammate: randomUUID(),
};
const teammateConnection = randomUUID();

async function delivery(
  id: string,
  values: {
    touchId: string;
    relationshipId: string;
    productId?: string;
    ownerId?: string;
    connectionId?: string;
    status: "sending" | "unknown" | "accepted" | "sent" | "failed";
    ageMs: number;
  },
) {
  await local.db.insert(s.deliveries).values({
    id,
    organizationId: org,
    productId: values.productId ?? demoId(10),
    relationshipId: values.relationshipId,
    ownerId: values.ownerId ?? demoUser,
    connectionId: values.connectionId ?? demoId(700),
    touchId: values.touchId,
    sourceVersion: 1,
    idempotencyKey: `fixture-${id}`,
    requestHash: "fixture",
    channel: "gmail",
    recipient: "person@example.test",
    draft: "Subject: Fixture\n\nBody",
    status: values.status,
    createdAt: new Date(Date.now() - values.ageMs),
  });
}

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  await local.db.insert(s.connections).values({
    id: teammateConnection,
    organizationId: org,
    productId: demoId(11),
    ownerId: "demo-teammate",
    provider: "gmail",
    externalAccountId: "fixture-teammate-gmail",
    status: "connected",
  });
  const old = 10 * 60000;
  await delivery(ids.unknown, {
    touchId: demoId(1304),
    relationshipId: demoId(304),
    status: "unknown",
    ageMs: old,
  });
  await delivery(ids.sending, {
    touchId: demoId(1302),
    relationshipId: demoId(300),
    status: "sending",
    ageMs: 1000,
  });
  await delivery(ids.accepted, {
    touchId: demoId(1307),
    relationshipId: demoId(308),
    status: "accepted",
    ageMs: old,
  });
  await delivery(ids.failed, {
    touchId: demoId(1304),
    relationshipId: demoId(304),
    status: "failed",
    ageMs: old,
  });
  await delivery(ids.sent, {
    touchId: demoId(1306),
    relationshipId: demoId(308),
    status: "sent",
    ageMs: old,
  });
  await delivery(ids.teammate, {
    touchId: demoId(1310),
    relationshipId: demoId(305),
    productId: demoId(11),
    ownerId: "demo-teammate",
    connectionId: teammateConnection,
    status: "unknown",
    ageMs: old,
  });
});
afterAll(async () => local.client.close());

function find(name: string) {
  const operation = operations.find((item) => item.name === name);
  if (!operation) throw new Error(`MISSING_OPERATION:${name}`);
  return operation;
}
type Listed = {
  id: string;
  status: string;
  ownerId: string;
  relationshipId: string;
  channel: string;
  recipient: string;
  canReconcile: boolean;
  canResolve: boolean;
};
async function list(principal: Principal, input: Record<string, unknown> = {}) {
  return (await find("list_deliveries").execute(
    { db: local.db, principal },
    { organizationId: org, ...input },
  )) as { items: Listed[] };
}

test("an admin sees every unresolved delivery with what they may do about it", async () => {
  const { items } = await list(admin);
  expect(items.map((item) => item.id).sort()).toEqual(
    [ids.unknown, ids.sending, ids.accepted, ids.teammate].sort(),
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  expect(byId.get(ids.unknown)).toMatchObject({
    status: "unknown",
    ownerId: demoUser,
    relationshipId: demoId(304),
    channel: "gmail",
    recipient: "person@example.test",
    canReconcile: true,
    canResolve: true,
  });
  expect(byId.get(ids.sending)).toMatchObject({
    status: "sending",
    canReconcile: false,
    canResolve: false,
  });
  expect(byId.get(ids.accepted)).toMatchObject({
    canReconcile: true,
    canResolve: true,
  });
  expect(byId.get(ids.teammate)).toMatchObject({
    ownerId: "demo-teammate",
    canReconcile: false,
    canResolve: true,
  });
});

test("a member sees only their own deliveries and cannot resolve them", async () => {
  const { items } = await list(teammate);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    id: ids.teammate,
    canReconcile: true,
    canResolve: false,
  });
});

test("an assistant never gets the human-only resolve and stays inside its products", async () => {
  const all = await list(adminAgent);
  expect(all.items.every((item) => !item.canResolve)).toBe(true);
  const scoped = await list({ ...adminAgent, productIds: [demoId(11)] });
  expect(scoped.items).toEqual([]);
  const filtered = await list(admin, { productId: demoId(11) });
  expect(filtered.items.map((item) => item.id)).toEqual([ids.teammate]);
  expect(operationRequirements(find("list_deliveries"))).toMatchObject({
    scopes: ["crm:read"],
    administrator: false,
  });
});
