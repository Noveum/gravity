import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { subscribeChanges } from "../packages/core/changes";
import { CrmService } from "../packages/core/crm";
import { authorize, type Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { mcpHandler, principalForGrant } from "../packages/mcp/server";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let service: CrmService;
const writable: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: demoId(1),
  readOnly: false,
};
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  service = new CrmService(local.db);
});
afterAll(async () => {
  await local.client.close();
});
async function call(
  name: string,
  args: Record<string, unknown> = {},
  principal = writable,
) {
  const response = await mcpHandler(local.db, principal, demoId(1)).fetch(
    new Request("http://127.0.0.1:3014/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.text();
  const envelope = JSON.parse(
    body
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6) ?? body,
  );
  if (envelope.result?.isError)
    return { error: envelope.result.content[0].text };
  if (envelope.error) return { error: envelope.error.message };
  return JSON.parse(envelope.result.content[0].text);
}

test("MCP writes create records, notify listeners, audit changes and reject stale approval versions", async () => {
  const hint = vi.fn();
  const unsubscribe = subscribeChanges(demoId(1), hint);
  try {
    const person = await call("create_person", {
      productId: demoId(11),
      name: "Fictional MCP Buyer",
      review: false,
    });
    expect(person.relationshipId).toBeTruthy();
    const action = await call("schedule_next_action", {
      relationshipId: person.relationshipId,
      ownerId: demoUser,
      kind: "reply",
      channel: "gmail",
      owedBy: "us",
      title: "Follow up",
      dueAt: new Date().toISOString(),
    });
    const saved = await call("change_action", {
      actionId: action.actionId,
      version: 1,
      command: "save",
      draft: "Fictional proposal",
    });
    const approved = await call("change_action", {
      actionId: action.actionId,
      version: saved.version,
      command: "approve",
    });
    expect(approved.approvedHash).toBe(approved.draftHash);
    expect(approved.approvedBy).toBe(demoUser);
    const stale = await call("change_action", {
      actionId: action.actionId,
      version: saved.version,
      command: "save",
      draft: "Stale",
    });
    expect(stale.error).toContain("CONFLICT");
    const edited = await call("change_action", {
      actionId: action.actionId,
      version: approved.version,
      command: "save",
      draft: "Updated proposal",
    });
    expect(edited.approvedHash).toBeNull();
    expect(hint).toHaveBeenCalledTimes(5);
    const snapshot = await service.snapshot(writable, {
      organizationId: demoId(1),
    });
    expect(snapshot.people.some((p) => p.id === person.personId)).toBe(true);
    expect(snapshot.actions.find((a) => a.id === action.actionId)?.draft).toBe(
      "Updated proposal",
    );
    const events = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.entityId, action.actionId));
    expect(events.map((e) => e.type)).toContain("action.approve");
  } finally {
    unsubscribe();
  }
});

test("write scopes cannot escape the authorized organization or products", async () => {
  const restricted = { ...writable, productIds: [demoId(11)] };
  expect(
    (
      await call(
        "create_person",
        { productId: demoId(10), name: "Forbidden" },
        restricted,
      )
    ).error,
  ).toContain("FORBIDDEN");
  expect(
    (await call("create_person", { productId: demoId(13), name: "Other org" }))
      .error,
  ).toContain("FORBIDDEN");
  expect(
    (await call("create_product", { name: "Scope escape" }, restricted)).error,
  ).toContain("FORBIDDEN");
  const readonly = { ...writable, readOnly: true };
  expect(
    (
      await call(
        "create_person",
        { productId: demoId(11), name: "Read only" },
        readonly,
      )
    ).error,
  ).toBeTruthy();
  await expect(
    service.createFolder(
      { ...writable, readOnly: undefined },
      { organizationId: demoId(1), productId: demoId(11), name: "Unverified" },
    ),
  ).rejects.toMatchObject({ status: 403 });
});

test("private conversation actions cannot be modified by another assistant user", async () => {
  const [action] = await local.db
    .insert(s.actions)
    .values({
      organizationId: demoId(1),
      productId: demoId(12),
      relationshipId: demoId(303),
      sourceConversationId: demoId(711),
      ownerId: demoUser,
      kind: "reply",
      channel: "linkedin",
      owedBy: "us",
      title: "Private reply",
      reason: "Fictional private context",
      dueAt: new Date(),
    })
    .returning();
  const denied = await call(
    "change_action",
    {
      actionId: action.id,
      version: action.version,
      command: "save",
      draft: "Forbidden private update",
    },
    { ...writable, userId: "demo-teammate" },
  );
  expect(denied.error).toContain("FORBIDDEN");
});

test("all-products grants include future permitted products without widening historical grants", async () => {
  const [grant] = await local.db
    .insert(s.mcpGrants)
    .values({ userId: demoUser, organizationId: demoId(1), productIds: ["*"] })
    .returning();
  const principal = await principalForGrant(local.db, demoUser, grant.id);
  expect(principal.readOnly).toBe(true);
  const product = await call(
    "create_product",
    { name: "Fictional Future Product" },
    { ...principal, readOnly: false },
  );
  expect(
    (await authorize(local.db, principal, demoId(1))).products.map((p) => p.id),
  ).toContain(product.id);
  for (const productIds of [[], [demoId(11)]]) {
    const [fixed] = await local.db
      .insert(s.mcpGrants)
      .values({ userId: demoUser, organizationId: demoId(1), productIds })
      .returning();
    const narrowed = await principalForGrant(local.db, demoUser, fixed.id);
    expect(
      (await authorize(local.db, narrowed, demoId(1))).products.map(
        (p) => p.id,
      ),
    ).toEqual(productIds);
  }
  await local.db
    .update(s.mcpGrants)
    .set({ active: false })
    .where(eq(s.mcpGrants.id, grant.id));
  await expect(
    principalForGrant(local.db, demoUser, grant.id),
  ).rejects.toMatchObject({ status: 403 });
});

test("all-products grants still follow membership and cannot create products for non-admins", async () => {
  const [grant] = await local.db
    .insert(s.mcpGrants)
    .values({
      userId: "demo-restricted",
      organizationId: demoId(1),
      productIds: ["*"],
    })
    .returning();
  const principal = {
    ...(await principalForGrant(local.db, "demo-restricted", grant.id)),
    readOnly: false,
  };
  expect(
    (await authorize(local.db, principal, demoId(1))).products.map((p) => p.id),
  ).toEqual([demoId(11)]);
  expect(
    (await call("create_product", { name: "Not admin" }, principal)).error,
  ).toContain("FORBIDDEN");
  await local.db
    .delete(s.productMemberships)
    .where(eq(s.productMemberships.userId, "demo-restricted"));
  expect(
    (await authorize(local.db, principal, demoId(1))).products,
  ).toHaveLength(0);
});

test("MCP can create and read private material but cannot attach another product's folder or stage", async () => {
  const folder = await call("create_material_folder", {
    productId: demoId(11),
    name: "Fictional sales kit",
  });
  const asset = await call("create_material", {
    productId: demoId(11),
    folderId: folder.id,
    name: "Proposal.md",
    content: "# Fictional proposal",
  });
  expect((await call("read_material", { assetId: asset.id })).text).toBe(
    "# Fictional proposal",
  );
  expect(
    (
      await call("create_material", {
        productId: demoId(10),
        folderId: folder.id,
        name: "No.md",
        content: "Forbidden",
      })
    ).error,
  ).toContain("NOT_FOUND");
  const [foreignStage] = await local.db
    .select()
    .from(s.stages)
    .where(eq(s.stages.productId, demoId(10)));
  expect(
    (
      await call("create_material", {
        productId: demoId(11),
        folderId: folder.id,
        stageIds: [foreignStage.id],
        name: "No.md",
        content: "Forbidden",
      })
    ).error,
  ).toContain("FORBIDDEN");
});

test("MCP turns a held meeting commitment into a follow-up without accepting stale versions", async () => {
  const args = {
    meetingId: demoId(1000),
    version: 1,
    ownerId: demoUser,
    dueAt: new Date().toISOString(),
  };
  const accepted = await call("accept_meeting_commitment", args);
  expect(accepted.actionId).toBeTruthy();
  expect((await call("accept_meeting_commitment", args)).error).toContain(
    "CONFLICT",
  );
  const snapshot = await call("get_workspace");
  expect(
    snapshot.actions.some((a: { id: string }) => a.id === accepted.actionId),
  ).toBe(true);
});
