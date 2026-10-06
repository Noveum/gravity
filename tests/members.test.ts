import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { authorize, type Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { principalForGrant } from "../packages/mcp/server";
import {
  operationAvailable,
  operationRequirements,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const admin: Principal = { userId: demoUser, source: "demo" };
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
async function addMember(userId: string, role: "admin" | "member" = "member") {
  await local.db
    .insert(s.user)
    .values({ id: userId, name: userId, email: `${userId}@example.test` });
  await local.db
    .insert(s.memberships)
    .values({ organizationId: org, userId, role });
}
async function owned(userId: string) {
  const relationships = await local.db
    .select({ id: s.relationships.id })
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.organizationId, org),
        eq(s.relationships.ownerId, userId),
      ),
    );
  const actions = await local.db
    .select({ id: s.actions.id })
    .from(s.actions)
    .leftJoin(
      s.conversations,
      eq(s.conversations.id, s.actions.sourceConversationId),
    )
    .where(
      and(
        eq(s.actions.organizationId, org),
        eq(s.actions.ownerId, userId),
        inArray(s.actions.status, ["open", "blocked"]),
        or(
          isNull(s.conversations.id),
          eq(s.conversations.visibility, "product"),
        ),
      ),
    );
  const touches = await local.db
    .select({ id: s.touches.id })
    .from(s.touches)
    .where(
      and(
        eq(s.touches.organizationId, org),
        eq(s.touches.senderId, userId),
        inArray(s.touches.status, ["planned", "drafted", "approved"]),
      ),
    );
  return {
    relationships: relationships.length,
    actions: actions.length,
    touches: touches.length,
  };
}

describe("member roles", () => {
  test("the last active admin cannot be demoted, and a second admin makes it possible", async () => {
    await expect(
      run("change_member_role", admin, { userId: demoUser, role: "member" }),
    ).rejects.toMatchObject({ code: "LAST_ADMIN", status: 409 });
    await run("change_member_role", admin, {
      userId: "demo-teammate",
      role: "admin",
    });
    const demoted = await run("change_member_role", admin, {
      userId: demoUser,
      role: "member",
    });
    expect(demoted).toMatchObject({ userId: demoUser, role: "member" });
    await expect(
      run("change_member_role", admin, {
        userId: "demo-restricted",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("an inactive admin does not count as the remaining admin", async () => {
    await addMember("fixture-admin", "admin");
    await local.db
      .update(s.memberships)
      .set({ active: false })
      .where(eq(s.memberships.userId, "fixture-admin"));
    await expect(
      run("change_member_role", admin, { userId: demoUser, role: "member" }),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });

  test("role changes need an administrator with an all-products grant", async () => {
    for (const principal of [
      teammate,
      { ...agent, productIds: [demoId(11)] },
      { ...agent, readOnly: true },
    ])
      await expect(
        run("change_member_role", principal, {
          userId: "demo-restricted",
          role: "admin",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const promoted = await run("change_member_role", admin, {
      userId: "demo-restricted",
      role: "admin",
    });
    expect(promoted).toMatchObject({ role: "admin" });
    const [event] = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.type, "member.role_changed"));
    expect(event?.actorId).toBe(demoUser);
  });
});

describe("member product access", () => {
  test("an admin grants and removes products, which changes what the member can read", async () => {
    const granted = await run("set_member_products", admin, {
      userId: "demo-restricted",
      productIds: [demoId(10), demoId(11)],
    });
    expect(granted).toMatchObject({
      userId: "demo-restricted",
      productIds: [demoId(10), demoId(11)],
    });
    const wider = await authorize(local.db, restricted, org);
    expect(wider.products.map((product) => product.id).sort()).toEqual([
      demoId(10),
      demoId(11),
    ]);
    await run("set_member_products", admin, {
      userId: "demo-restricted",
      productIds: [],
    });
    expect((await authorize(local.db, restricted, org)).products).toEqual([]);
  });

  test("products from another organization and unknown members are refused", async () => {
    await expect(
      run("set_member_products", admin, {
        userId: "demo-restricted",
        productIds: [demoId(13)],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      run("set_member_products", admin, {
        userId: "nobody",
        productIds: [demoId(10)],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      run("set_member_products", teammate, {
        userId: "demo-restricted",
        productIds: [demoId(10)],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("listing members", () => {
  type Listed = {
    members: {
      userId: string;
      email: string;
      role: string;
      active: boolean;
      allProducts: boolean;
      productIds: string[];
      owned: { relationships: number; actions: number; touches: number };
    }[];
  };
  const byId = (result: Listed) =>
    new Map(result.members.map((item) => [item.userId, item]));
  test("any member reads roles, active state, products and owned work", async () => {
    const members = byId(await run<Listed>("list_members", teammate, {}));
    expect([...members.keys()].sort()).toEqual(
      ["demo-restricted", "demo-teammate", demoUser].sort(),
    );
    expect(members.get("demo-teammate")).toMatchObject({
      role: "member",
      active: true,
      allProducts: false,
      email: "sam@example.test",
      productIds: [demoId(10), demoId(11), demoId(12)],
      owned: await owned("demo-teammate"),
    });
    expect(members.get(demoUser)).toMatchObject({
      role: "admin",
      allProducts: true,
      owned: await owned(demoUser),
    });
  });

  test("a product-restricted member only sees products and work they can read", async () => {
    const members = byId(await run<Listed>("list_members", restricted, {}));
    expect(members.get("demo-teammate")?.productIds).toEqual([demoId(11)]);
    expect(members.get(demoUser)?.owned).toEqual({
      relationships: 0,
      actions: 0,
      touches: 0,
    });
  });
});

describe("deactivating members", () => {
  test("work is reassigned to the caller in one transaction and the response reports the counts", async () => {
    const before = await owned("demo-teammate");
    expect(before.relationships).toBeGreaterThan(0);
    expect(before.actions).toBeGreaterThan(0);
    expect(before.touches).toBeGreaterThan(0);
    const callerBefore = await owned(demoUser);
    const result = await run("deactivate_member", admin, {
      userId: "demo-teammate",
    });
    expect(result).toMatchObject({
      userId: "demo-teammate",
      active: false,
      reassignedTo: demoUser,
      reassigned: before,
    });
    expect(await owned("demo-teammate")).toEqual({
      relationships: 0,
      actions: 0,
      touches: 0,
    });
    expect(await owned(demoUser)).toEqual({
      relationships: callerBefore.relationships + before.relationships,
      actions: callerBefore.actions + before.actions,
      touches: callerBefore.touches + before.touches,
    });
    const [membership] = await local.db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.userId, "demo-teammate"));
    expect(membership?.active).toBe(false);
  });

  test("an approved touch moved to a new sender loses its approval", async () => {
    await local.db
      .update(s.relationships)
      .set({ ownerId: "demo-teammate" })
      .where(eq(s.relationships.id, demoId(304)));
    await local.db
      .update(s.touches)
      .set({ senderId: "demo-teammate" })
      .where(eq(s.touches.relationshipId, demoId(304)));
    await run("deactivate_member", admin, {
      userId: "demo-teammate",
      reassignToUserId: demoUser,
    });
    const moved = await local.db
      .select()
      .from(s.touches)
      .where(eq(s.touches.relationshipId, demoId(304)));
    const open = moved.filter((touch) => touch.sentAt === null);
    expect(open.length).toBeGreaterThan(0);
    for (const touch of open) {
      expect(touch.senderId).toBe(demoUser);
      expect(touch.status).toBe("drafted");
      expect(touch.approvedHash).toBeNull();
    }
    for (const touch of moved.filter((touch) => touch.sentAt !== null))
      expect(touch.senderId).toBe("demo-teammate");
  });

  test("the member's session and MCP grant for the organization stop working", async () => {
    const [grant] = await local.db
      .insert(s.mcpGrants)
      .values({
        organizationId: org,
        userId: "demo-teammate",
        productIds: ["*"],
      })
      .returning();
    if (!grant) throw new Error("grant fixture");
    await expect(
      principalForGrant(local.db, "demo-teammate", grant.id),
    ).resolves.toMatchObject({ organizationId: org });
    const result = await run("deactivate_member", admin, {
      userId: "demo-teammate",
    });
    expect(result).toMatchObject({ revokedGrants: 1 });
    await expect(
      principalForGrant(local.db, "demo-teammate", grant.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorize(local.db, teammate, org)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await run("reactivate_member", admin, { userId: "demo-teammate" });
    await expect(authorize(local.db, teammate, org)).resolves.toBeTruthy();
    await expect(
      principalForGrant(local.db, "demo-teammate", grant.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("the last active admin cannot be deactivated", async () => {
    await addMember("fixture-member");
    await expect(
      run("deactivate_member", admin, {
        userId: demoUser,
        reassignToUserId: "fixture-member",
      }),
    ).rejects.toMatchObject({ code: "LAST_ADMIN", status: 409 });
  });

  test("the new owner must be another active member who can access the work", async () => {
    await addMember("fixture-empty");
    await expect(
      run("deactivate_member", admin, {
        userId: "demo-teammate",
        reassignToUserId: "fixture-empty",
      }),
    ).rejects.toMatchObject({ code: "OWNER_NOT_ALLOWED" });
    expect((await owned("demo-teammate")).relationships).toBeGreaterThan(0);
    await local.db
      .update(s.memberships)
      .set({ active: false })
      .where(eq(s.memberships.userId, "demo-restricted"));
    for (const reassignToUserId of ["demo-restricted", "demo-teammate"])
      await expect(
        run("deactivate_member", admin, {
          userId: "demo-teammate",
          reassignToUserId,
        }),
      ).rejects.toMatchObject({ code: "REASSIGN_TARGET_INVALID" });
    const [membership] = await local.db
      .select()
      .from(s.memberships)
      .where(eq(s.memberships.userId, "demo-teammate"));
    expect(membership?.active).toBe(true);
  });

  test("deactivation needs an administrator with an all-products grant", async () => {
    for (const principal of [teammate, { ...agent, productIds: [demoId(11)] }])
      await expect(
        run("deactivate_member", principal, { userId: "demo-restricted" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

test("the permission audit reports every member operation and its requirement", () => {
  const adminOnly = [
    "set_member_products",
    "change_member_role",
    "deactivate_member",
    "reactivate_member",
  ];
  for (const name of adminOnly) {
    expect(operationRequirements(find(name))).toMatchObject({
      administrator: true,
      allProducts: true,
    });
    expect(operationAvailable(find(name), agent, "member")).toBe(false);
    expect(
      operationAvailable(find(name), { ...agent, productIds: [] }, "admin"),
    ).toBe(false);
    expect(operationAvailable(find(name), agent, "admin")).toBe(
      name !== "reactivate_member",
    );
  }
  expect(operationRequirements(find("list_members"))).toMatchObject({
    administrator: false,
    allProducts: false,
  });
  expect(operationAvailable(find("list_members"), agent, "member")).toBe(true);
});

describe("agents reduce access but never grant it", () => {
  test("an agent cannot promote a member to admin but can demote one", async () => {
    await expect(
      run("change_member_role", agent, {
        userId: "demo-restricted",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED", status: 403 });
    await run("change_member_role", admin, {
      userId: "demo-restricted",
      role: "admin",
    });
    await expect(
      run("change_member_role", agent, {
        userId: "demo-restricted",
        role: "member",
      }),
    ).resolves.toMatchObject({ role: "member" });
  });

  test("an agent cannot add a product to a member but can remove one", async () => {
    await run("set_member_products", admin, {
      userId: "demo-restricted",
      productIds: [demoId(10)],
    });
    await expect(
      run("set_member_products", agent, {
        userId: "demo-restricted",
        productIds: [demoId(10), demoId(11)],
      }),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await expect(
      run("set_member_products", agent, {
        userId: "demo-restricted",
        productIds: [demoId(11)],
      }),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    expect(
      (await authorize(local.db, restricted, org)).products.map((p) => p.id),
    ).toEqual([demoId(10)]);
    await expect(
      run("set_member_products", agent, {
        userId: "demo-restricted",
        productIds: [],
      }),
    ).resolves.toMatchObject({ productIds: [] });
  });

  test("an agent can deactivate a member but only a person can reactivate one", async () => {
    await expect(
      run("deactivate_member", agent, { userId: "demo-restricted" }),
    ).resolves.toBeTruthy();
    await expect(
      run("reactivate_member", agent, { userId: "demo-restricted" }),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await expect(
      run("reactivate_member", admin, { userId: "demo-restricted" }),
    ).resolves.toMatchObject({ active: true });
  });

  test("granting operations are hidden from agents and flagged human-only", () => {
    expect(operationRequirements(find("reactivate_member")).humanSession).toBe(
      true,
    );
    expect(operationAvailable(find("reactivate_member"), agent, "admin")).toBe(
      false,
    );
    for (const name of [
      "change_member_role",
      "set_member_products",
      "deactivate_member",
    ]) {
      expect(operationRequirements(find(name)).humanSession).toBe(false);
      expect(operationAvailable(find(name), agent, "admin")).toBe(true);
    }
    expect(find("change_member_role").description).toContain(
      "HUMAN_ACTION_REQUIRED",
    );
    expect(find("set_member_products").description).toContain(
      "HUMAN_ACTION_REQUIRED",
    );
  });
});

test("deactivating an admin revokes the invitations they still have pending", async () => {
  await addMember("fixture-admin", "admin");
  const pending = (email: string, invitedBy: string) => ({
    organizationId: org,
    email,
    tokenHash: `hash-${email}`,
    expiresAt: new Date(Date.now() + 86400000),
    invitedBy,
  });
  const [theirs, accepted, mine] = await local.db
    .insert(s.invitations)
    .values([
      pending("theirs@example.test", "fixture-admin"),
      {
        ...pending("accepted@example.test", "fixture-admin"),
        acceptedAt: new Date(),
        acceptedBy: demoUser,
      },
      pending("mine@example.test", demoUser),
    ])
    .returning();
  await run("deactivate_member", admin, { userId: "fixture-admin" });
  const rows = await local.db
    .select()
    .from(s.invitations)
    .where(eq(s.invitations.organizationId, org));
  const state = (id: string | undefined) => rows.find((row) => row.id === id);
  expect(state(theirs?.id)?.revokedAt).toBeInstanceOf(Date);
  expect(state(accepted?.id)?.revokedAt).toBeNull();
  expect(state(mine?.id)?.revokedAt).toBeNull();
  const events = await local.db
    .select()
    .from(s.changeEvents)
    .where(eq(s.changeEvents.type, "invitation.revoked"));
  expect(events.map((event) => event.entityId)).toEqual([theirs?.id]);
});

test("a read-only grant reads members but every administration change is refused", async () => {
  const reader = { ...agent, readOnly: true };
  await expect(run("list_members", reader, {})).resolves.toBeTruthy();
  const changes: [string, Record<string, unknown>][] = [
    ["change_member_role", { userId: "demo-restricted", role: "member" }],
    ["set_member_products", { userId: "demo-restricted", productIds: [] }],
    ["deactivate_member", { userId: "demo-restricted" }],
    ["reactivate_member", { userId: "demo-restricted" }],
  ];
  for (const [name, input] of changes)
    await expect(run(name, reader, input), name).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  const [membership] = await local.db
    .select()
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.organizationId, org),
        eq(s.memberships.userId, "demo-restricted"),
      ),
    );
  expect(membership?.active).toBe(true);
});
