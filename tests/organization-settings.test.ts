import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import { OrganizationSettingsService } from "../packages/core/organization-settings";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  apiOperation,
  executeMcpOperation,
  operationAvailable,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let settings: OrganizationSettingsService;
const admin: Principal = { userId: demoUser, source: "session" };
const organizationId = demoId(1);
const productIds = [demoId(10)];
let now = Date.now();
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  settings = new OrganizationSettingsService(local.db, () => now);
});
afterAll(async () => {
  await local.client.close();
});
async function recipient() {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await local.db
    .insert(s.user)
    .values({ id, email, name: "Fictional Teammate", emailVerified: true });
  return { id, email, principal: { userId: id, source: "session" as const } };
}
const tokenOf = (created: { acceptUrl: string }) =>
  new URL(created.acceptUrl).hash.slice(1);
const invitation = (email: string) => ({
  organizationId,
  email,
  role: "member" as const,
  productIds,
});

test("invitations join only their verified recipient with the selected product access and are replay safe", async () => {
  const user = await recipient();
  const created = await settings.invite(
    admin,
    invitation(user.email.toUpperCase()),
  );
  const listed = await settings.invitations(admin, { organizationId });
  expect(listed.find((entry) => entry.id === created.id)?.email).toBe(
    user.email,
  );
  expect(JSON.stringify(listed)).not.toContain(tokenOf(created));
  const [stored] = await local.db
    .select()
    .from(s.invitations)
    .where(eq(s.invitations.id, created.id));
  expect(stored.tokenHash).not.toBe(tokenOf(created));
  expect(created.acceptUrl).toMatch(/\/invite#[a-f0-9]{64}$/);
  expect(created).not.toHaveProperty("token");
  await expect(
    settings.accept(admin, { token: tokenOf(created) }),
  ).rejects.toMatchObject({ code: "INVITE_EMAIL_MISMATCH" });
  await local.db
    .update(s.user)
    .set({ emailVerified: false })
    .where(eq(s.user.id, user.id));
  await expect(
    settings.accept(user.principal, { token: tokenOf(created) }),
  ).rejects.toMatchObject({ code: "INVITE_EMAIL_MISMATCH" });
  await local.db
    .update(s.user)
    .set({ emailVerified: true })
    .where(eq(s.user.id, user.id));
  expect(
    await settings.accept(user.principal, { token: tokenOf(created) }),
  ).toEqual({ organizationId });
  expect(
    await settings.accept(user.principal, { token: tokenOf(created) }),
  ).toEqual({ organizationId });
  const snapshot = await new CrmService(local.db).snapshot(user.principal, {
    organizationId,
  });
  expect(snapshot.products.map((product) => product.id)).toEqual(productIds);
  expect(
    await settings.invitations(admin, { organizationId }),
  ).not.toContainEqual(expect.objectContaining({ id: created.id }));
  await expect(
    settings.invite(admin, invitation(user.email)),
  ).rejects.toMatchObject({ code: "MEMBER_EXISTS" });
  await local.db
    .update(s.memberships)
    .set({ active: false })
    .where(
      and(
        eq(s.memberships.organizationId, organizationId),
        eq(s.memberships.userId, user.id),
      ),
    );
  await expect(
    settings.accept(user.principal, { token: tokenOf(created) }),
  ).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
});

test("revoked, replaced and expired links cannot join and invitations remain tenant isolated", async () => {
  const user = await recipient();
  const first = await settings.invite(admin, invitation(user.email));
  const second = await settings.invite(admin, invitation(user.email));
  await expect(
    settings.accept(user.principal, { token: tokenOf(first) }),
  ).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
  await settings.revoke(admin, {
    organizationId: demoId(2),
    invitationId: second.id,
  });
  expect(
    (await settings.invitations(admin, { organizationId })).some(
      (entry) => entry.id === second.id,
    ),
  ).toBe(true);
  await settings.revoke(admin, { organizationId, invitationId: second.id });
  await expect(
    settings.accept(user.principal, { token: tokenOf(second) }),
  ).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
  const expiring = await settings.invite(admin, invitation(user.email));
  now += 15 * 24 * 60 * 60 * 1000;
  await expect(
    settings.accept(user.principal, { token: tokenOf(expiring) }),
  ).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
  now = Date.now();
});

test("members, read-only assistants and product restricted assistants cannot manage organization access", async () => {
  const user = await recipient();
  for (const principal of [
    { userId: "demo-teammate", source: "session" as const },
    { ...admin, source: "mcp" as const, readOnly: true, organizationId },
    {
      ...admin,
      source: "mcp" as const,
      readOnly: false,
      organizationId,
      productIds,
    },
  ])
    await expect(
      settings.invite(principal, invitation(user.email)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    settings.invite(admin, {
      ...invitation(user.email),
      productIds: [demoId(13)],
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    settings.invite(admin, { ...invitation(user.email), productIds: [] }),
  ).rejects.toThrow();
  const created = await settings.invite(admin, invitation(user.email));
  await expect(
    settings.accept(
      { ...user.principal, source: "mcp", readOnly: false },
      { token: tokenOf(created) },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await local.db
    .update(s.memberships)
    .set({ active: false })
    .where(
      and(
        eq(s.memberships.organizationId, organizationId),
        eq(s.memberships.userId, demoUser),
      ),
    );
  await expect(
    settings.accept(user.principal, { token: tokenOf(created) }),
  ).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
  await expect(
    settings.preview(user.principal, { token: tokenOf(created) }),
  ).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
  await local.db
    .update(s.memberships)
    .set({ active: true })
    .where(
      and(
        eq(s.memberships.organizationId, organizationId),
        eq(s.memberships.userId, demoUser),
      ),
    );
});

test("member access changes are atomic, preserve the last admin, and cannot cross tenants", async () => {
  await expect(
    settings.updateMember(admin, {
      organizationId,
      userId: demoUser,
      role: "member",
      productIds,
    }),
  ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  await settings.updateMember(admin, {
    organizationId,
    userId: "demo-teammate",
    role: "member",
    productIds: [demoId(11)],
  });
  const snapshot = await new CrmService(local.db).snapshot(
    { userId: "demo-teammate", source: "session" },
    { organizationId },
  );
  expect(snapshot.products.map((product) => product.id)).toEqual([demoId(11)]);
  await expect(
    settings.updateMember(admin, {
      organizationId,
      userId: "demo-teammate",
      role: "member",
      productIds: [demoId(13)],
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    settings.updateMember(admin, {
      organizationId: demoId(2),
      userId: "demo-teammate",
      role: "admin",
      productIds: [],
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("organization details validate time zones and enforce admin permissions through the shared operation registry", async () => {
  const operation = apiOperation("crm", "POST", "organization-settings");
  await expect(
    operation.execute(
      {
        db: local.db,
        principal: { userId: "demo-teammate", source: "session" },
      },
      { organizationId, name: "Northstar", timezone: "Asia/Kolkata" },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    settings.updateOrganization(admin, {
      organizationId,
      name: "Northstar",
      timezone: "Invalid/Zone",
    }),
  ).rejects.toThrow();
  await operation.execute(
    { db: local.db, principal: admin },
    { organizationId, name: "Northstar", timezone: "Asia/Kolkata" },
  );
  expect(
    (await new CrmService(local.db).organizations(admin)).find(
      (org) => org.id === organizationId,
    )?.timezone,
  ).toBe("Asia/Kolkata");
  const create = apiOperation("crm", "POST", "invitation");
  const assistant = {
    ...admin,
    source: "mcp" as const,
    readOnly: false,
    organizationId,
  };
  expect(
    operationAvailable(create, { ...assistant, productIds }, "admin"),
  ).toBe(false);
  expect(operationAvailable(create, assistant, "admin")).toBe(false);
  const user = await recipient();
  await expect(
    executeMcpOperation(
      create,
      { db: local.db, principal: assistant },
      organizationId,
      { email: user.email, role: "member", productIds },
    ),
  ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
  expect(
    operationAvailable(
      apiOperation("crm", "POST", "invitation-accept"),
      assistant,
      "admin",
    ),
  ).toBe(false);
});

test("membership removal revokes reads, preserves records, blocks old links and changes the live revision", async () => {
  const user = await recipient();
  const crm = new CrmService(local.db);
  const before = await crm.revision(admin, organizationId);
  const created = await settings.invite(admin, invitation(user.email));
  expect(await crm.revision(admin, organizationId)).not.toBe(before);
  await expect(
    settings.preview(admin, { token: tokenOf(created) }),
  ).rejects.toMatchObject({ code: "INVITE_EMAIL_MISMATCH" });
  expect(
    await settings.preview(user.principal, { token: tokenOf(created) }),
  ).toMatchObject({
    email: user.email,
    role: "member",
    products: ["AI Platform"],
  });
  await settings.accept(user.principal, { token: tokenOf(created) });
  const joinedRevision = await crm.revision(admin, organizationId);
  await settings.removeMember(admin, { organizationId, userId: user.id });
  expect(await crm.revision(admin, organizationId)).not.toBe(joinedRevision);
  await expect(
    crm.snapshot(user.principal, { organizationId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    settings.accept(user.principal, { token: tokenOf(created) }),
  ).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
  await expect(
    settings.removeMember(admin, { organizationId, userId: demoUser }),
  ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  const replacement = await settings.invite(admin, invitation(user.email));
  await settings.accept(user.principal, { token: tokenOf(replacement) });
  expect(
    (await crm.snapshot(user.principal, { organizationId })).products.map(
      (product) => product.id,
    ),
  ).toEqual(productIds);
});

test("concurrent admin demotions keep an administrator", async () => {
  const workspace = await new CrmService(local.db).createWorkspace(admin, {
    name: "Fictional Team",
    productName: "Fictional Product",
    timezone: "UTC",
  });
  const user = await recipient();
  const created = await settings.invite(admin, {
    organizationId: workspace.organizationId,
    email: user.email,
    role: "admin",
    productIds: [],
  });
  await settings.accept(user.principal, { token: tokenOf(created) });
  const results = await Promise.allSettled(
    [admin, user.principal].map((principal) =>
      settings.updateMember(principal, {
        organizationId: workspace.organizationId,
        userId: principal.userId,
        role: "member",
        productIds: [workspace.productId],
      }),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const members = await local.db
    .select()
    .from(s.memberships)
    .where(eq(s.memberships.organizationId, workspace.organizationId));
  expect(
    members.filter((member) => member.active && member.role === "admin"),
  ).toHaveLength(1);
});
