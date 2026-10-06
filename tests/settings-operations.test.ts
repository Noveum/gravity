import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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
const owner: Principal = { userId: demoUser, source: "session" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const restricted: Principal = { userId: "demo-restricted", source: "session" };
const agent: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: org,
  readOnly: false,
};

beforeEach(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterEach(async () => {
  await local.client.close();
});

function find(name: string) {
  const operation = operations.find((item) => item.name === name);
  if (!operation) throw new Error(`MISSING_OPERATION:${name}`);
  return operation;
}
async function run<T = Record<string, unknown>>(
  name: string,
  principal: Principal,
  input: Record<string, unknown>,
) {
  return (await find(name).execute(
    { db: local.db, principal },
    { organizationId: org, ...input },
  )) as T;
}
async function connection(ownerId: string, productId: string) {
  const [row] = await local.db
    .insert(s.connections)
    .values({
      organizationId: org,
      ownerId,
      provider: "gmail",
      productId,
      externalAccountId: `fixture-${ownerId}-${productId}`,
      displayName: "fixture@example.test",
      status: "connected",
    })
    .returning();
  if (!row) throw new Error("connection fixture");
  return row;
}
describe("update_connection", () => {
  test("the owner moves a connection to another product without new consent", async () => {
    const row = await connection(demoUser, demoId(10));
    const updated = await run<{ id: string; productId: string }>(
      "update_connection",
      owner,
      { connectionId: row.id, productId: demoId(11) },
    );
    expect(updated).toMatchObject({ id: row.id, productId: demoId(11) });
    const [stored] = await local.db
      .select()
      .from(s.connections)
      .where(eq(s.connections.id, row.id));
    expect(stored?.productId).toBe(demoId(11));
    expect(stored?.encryptedCredentials).toBe(row.encryptedCredentials);
    expect(stored?.status).toBe("connected");
    const events = await local.db
      .select()
      .from(s.changeEvents)
      .where(
        and(
          eq(s.changeEvents.entityId, row.id),
          eq(s.changeEvents.type, "connection.product_changed"),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.productId).toBe(demoId(11));
    await run("update_connection", agent, {
      connectionId: row.id,
      productId: demoId(12),
    });
  });

  test("only the owner may change it, into an active product they can write", async () => {
    const row = await connection(demoUser, demoId(10));
    await expect(
      run("update_connection", teammate, {
        connectionId: row.id,
        productId: demoId(11),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const limited = await connection("demo-restricted", demoId(11));
    await expect(
      run("update_connection", restricted, {
        connectionId: limited.id,
        productId: demoId(10),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await run("archive_product", owner, { productId: demoId(12) });
    await expect(
      run("update_connection", owner, {
        connectionId: row.id,
        productId: demoId(12),
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_ARCHIVED" });
    await expect(
      run(
        "update_connection",
        { ...agent, readOnly: true },
        { connectionId: row.id, productId: demoId(11) },
      ),
    ).rejects.toMatchObject({ status: 403 });
    const [stored] = await local.db
      .select()
      .from(s.connections)
      .where(eq(s.connections.id, row.id));
    expect(stored?.productId).toBe(demoId(10));
    expect(operationRequirements(find("update_connection"))).toMatchObject({
      administrator: false,
      currentAccountOrSourceOwner: true,
    });
  });
});
