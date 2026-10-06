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

const access = (
  userId: string,
  role: "admin" | "member",
  productIds: string[] = [],
) => ({ userId, role, productIds });

describe("member roles", () => {
  test("the last active admin cannot be demoted, and a second admin makes it possible", async () => {
    await expect(
      run(
        "update_member_access",
        admin,
        access(demoUser, "member", [demoId(10)]),
      ),
    ).rejects.toMatchObject({ code: "LAST_ADMIN", status: 409 });
    await run("update_member_access", admin, access("demo-teammate", "admin"));
    await run(
      "update_member_access",
      admin,
      access(demoUser, "member", [demoId(10)]),
    );
    const [membership] = await local.db
      .select()
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.organizationId, org),
          eq(s.memberships.userId, demoUser),
        ),
      );
    expect(membership?.role).toBe("member");
    await expect(
      run("update_member_access", admin, access("demo-restricted", "admin")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("an inactive admin does not count as the remaining admin", async () => {
    await addMember("fixture-admin", "admin");
    await local.db
      .update(s.memberships)
      .set({ active: false })
      .where(eq(s.memberships.userId, "fixture-admin"));
    await expect(
      run(
        "update_member_access",
        admin,
        access(demoUser, "member", [demoId(10)]),
      ),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
    await addMember("fixture-member");
    await expect(
      run("remove_member", admin, {
        userId: demoUser,
        reassignToUserId: "fixture-member",
      }),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });

  test("access changes need an administrator with an all-products grant", async () => {
    for (const principal of [
      teammate,
      { ...agent, productIds: [demoId(11)] },
      { ...agent, readOnly: true },
    ])
      await expect(
        run(
          "update_member_access",
          principal,
          access("demo-restricted", "admin"),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await run(
      "update_member_access",
      admin,
      access("demo-restricted", "admin"),
    );
    const [event] = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.type, "member.access-changed"));
    expect(event?.actorId).toBe(demoUser);
  });
});

describe("member product access", () => {
  test("an admin grants and narrows products, which changes what the member can read", async () => {
    await run(
      "update_member_access",
      admin,
      access("demo-restricted", "member", [demoId(10), demoId(11)]),
    );
    const wider = await authorize(local.db, restricted, org);
    expect(wider.products.map((product) => product.id).sort()).toEqual([
      demoId(10),
      demoId(11),
    ]);
    await run(
      "update_member_access",
      admin,
      access("demo-restricted", "member", [demoId(10)]),
    );
    expect(
      (await authorize(local.db, restricted, org)).products.map((p) => p.id),
    ).toEqual([demoId(10)]);
  });

  test("products from another organization and unknown members are refused", async () => {
    await expect(
      run(
        "update_member_access",
        admin,
        access("demo-restricted", "member", [demoId(13)]),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run(
        "update_member_access",
        admin,
        access("nobody", "member", [demoId(10)]),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      run(
        "update_member_access",
        teammate,
        access("demo-restricted", "member", [demoId(10)]),
      ),
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
    const result = await run("remove_member", admin, {
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
    await run("remove_member", admin, {
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
    const result = await run("remove_member", admin, {
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
      run("remove_member", admin, {
        userId: demoUser,
        reassignToUserId: "fixture-member",
      }),
    ).rejects.toMatchObject({ code: "LAST_ADMIN", status: 409 });
  });

  test("the new owner must be another active member who can access the work", async () => {
    await addMember("fixture-empty");
    await expect(
      run("remove_member", admin, {
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
        run("remove_member", admin, {
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
        run("remove_member", principal, { userId: "demo-restricted" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

test("the permission audit reports every member operation and its requirement", () => {
  const adminOnly = [
    "update_member_access",
    "remove_member",
    "reactivate_member",
    "create_invitation",
    "revoke_invitation",
    "list_invitations",
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
      !["reactivate_member", "create_invitation"].includes(name),
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
      run("update_member_access", agent, access("demo-restricted", "admin")),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED", status: 403 });
    await run(
      "update_member_access",
      admin,
      access("demo-restricted", "admin"),
    );
    await expect(
      run(
        "update_member_access",
        agent,
        access("demo-restricted", "member", [demoId(10), demoId(11)]),
      ),
    ).resolves.toBeTruthy();
    expect((await authorize(local.db, restricted, org)).membership.role).toBe(
      "member",
    );
  });

  test("an agent cannot add a product to a member but can remove one, and a mixed change is refused whole", async () => {
    await run(
      "update_member_access",
      admin,
      access("demo-restricted", "member", [demoId(10), demoId(12)]),
    );
    await expect(
      run(
        "update_member_access",
        agent,
        access("demo-restricted", "member", [
          demoId(10),
          demoId(11),
          demoId(12),
        ]),
      ),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await expect(
      run(
        "update_member_access",
        agent,
        access("demo-restricted", "member", [demoId(11)]),
      ),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    expect(
      (await authorize(local.db, restricted, org)).products
        .map((p) => p.id)
        .sort(),
    ).toEqual([demoId(10), demoId(12)]);
    await run(
      "update_member_access",
      agent,
      access("demo-restricted", "member", [demoId(10)]),
    );
    expect(
      (await authorize(local.db, restricted, org)).products.map((p) => p.id),
    ).toEqual([demoId(10)]);
  });

  test("an agent can remove a member but only a person can reactivate one", async () => {
    await expect(
      run("remove_member", agent, { userId: "demo-restricted" }),
    ).resolves.toBeTruthy();
    await expect(
      run("reactivate_member", agent, { userId: "demo-restricted" }),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await expect(
      run("reactivate_member", admin, { userId: "demo-restricted" }),
    ).resolves.toMatchObject({ active: true });
  });

  test("granting operations are hidden from agents and flagged human-only", () => {
    for (const name of ["reactivate_member", "create_invitation"]) {
      expect(operationRequirements(find(name)).humanSession).toBe(true);
      expect(operationAvailable(find(name), agent, "admin")).toBe(false);
      expect(find(name).description).toContain("HUMAN_ACTION_REQUIRED");
    }
    for (const name of [
      "update_member_access",
      "remove_member",
      "revoke_invitation",
      "list_invitations",
    ]) {
      expect(operationRequirements(find(name)).humanSession).toBe(false);
      expect(operationAvailable(find(name), agent, "admin")).toBe(true);
    }
    expect(find("update_member_access").description).toContain(
      "HUMAN_ACTION_REQUIRED",
    );
  });
});

test("deactivating an admin revokes the invitations they still have pending", async () => {
  await addMember("fixture-admin", "admin");
  const pending = (email: string, inviterId: string) => ({
    organizationId: org,
    email,
    role: "member" as const,
    productIds: [demoId(10)],
    tokenHash: `hash-${email}`,
    expiresAt: new Date(Date.now() + 86400000),
    inviterId,
  });
  const [theirs, accepted, mine] = await local.db
    .insert(s.invitations)
    .values([
      pending("theirs@example.test", "fixture-admin"),
      {
        ...pending("accepted@example.test", "fixture-admin"),
        acceptedAt: new Date(),
      },
      pending("mine@example.test", demoUser),
    ])
    .returning();
  await run("remove_member", admin, { userId: "fixture-admin" });
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
    ["update_member_access", access("demo-restricted", "admin")],
    ["update_member_access", access("demo-restricted", "member", [demoId(11)])],
    ["remove_member", { userId: "demo-restricted" }],
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
