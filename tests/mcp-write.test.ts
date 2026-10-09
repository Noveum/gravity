import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { subscribeChanges } from "../packages/core/changes";
import { CrmService } from "../packages/core/crm";
import { OutreachService } from "../packages/core/outreach";
import { authorize, type Principal } from "../packages/core/policy";
import { RecordService } from "../packages/core/records";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { mcpHandler, principalForGrant } from "../packages/mcp/server";
import {
  operationRequirements,
  operations,
} from "../packages/operations/catalog";

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
async function rpc(
  method: string,
  params: Record<string, unknown>,
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
        method,
        params,
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
  return envelope;
}
async function call(
  name: string,
  args: Record<string, unknown> = {},
  principal = writable,
) {
  const envelope = await rpc(
    "tools/call",
    { name, arguments: args },
    principal,
  );
  if (envelope.result?.isError)
    return { error: envelope.result.content[0].text };
  if (envelope.error) return { error: envelope.error.message };
  return JSON.parse(envelope.result.content[0].text);
}

test("MCP discovery exposes every business API with valid schemas and read-only tokens cannot discover writes", async () => {
  const { result, error } = await rpc(
    "tools/list",
    {},
    { ...writable, canSend: true },
  );
  expect(error).toBeUndefined();
  const names = result.tools.map((tool: { name: string }) => tool.name);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toHaveLength(
    operations.filter((item) => !operationRequirements(item).humanSession)
      .length + 7,
  );
  expect(names).toEqual(
    expect.arrayContaining([
      "ingest_history",
      "list_native_drafts",
      "ingest_draft",
      "edit_native_draft",
      "schedule_native_draft",
      "list_internal_tasks",
      "create_internal_task",
      "change_internal_task",
      "update_action_reason",
      "get_yodu_sources",
      "create_yodu_source",
      "update_yodu_source",
      "bind_yodu_subject",
      "list_yodu_events",
      "delete_deal",
      "restore_deal",
    ]),
  );
  expect(
    new Set(
      operations.map((item) => `${item.api}:${item.method}:${item.operation}`),
    ).size,
  ).toBe(operations.length);
  for (const operation of operations) {
    const tool = result.tools.find(
      (tool: { name: string }) => tool.name === operation.name,
    );
    if (operationRequirements(operation).humanSession) {
      expect(tool).toBeUndefined();
      continue;
    }
    expect(tool).toBeTruthy();
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties).not.toHaveProperty("organizationId");
    expect(tool.annotations.readOnlyHint).toBe(operation.method === "GET");
  }
  const readonly = await rpc("tools/list", {}, { ...writable, readOnly: true });
  const readNames = readonly.result.tools.map(
    (tool: { name: string }) => tool.name,
  );
  for (const operation of operations.filter((item) => item.method !== "GET")) {
    expect(readNames).not.toContain(operation.name);
  }
  const capabilities = await call("get_capabilities");
  expect(capabilities.operations).toHaveLength(operations.length);
  expect(capabilities.sendMessages).toBe(false);
  expect(capabilities.typedRelationshipFields).toContain("datetime");
  expect(capabilities.contractSigningWorkflow).toBe(false);
  expect(capabilities.workspaceInvitations).toEqual({
    list: true,
    revoke: true,
    create: false,
  });
  const readerCapabilities = await call(
    "get_capabilities",
    {},
    {
      ...writable,
      readOnly: true,
    },
  );
  expect(readerCapabilities.workspaceInvitations).toEqual({
    list: true,
    revoke: false,
    create: false,
  });
});
test("update_person preserves omitted summary and permits an explicit replacement or clear", async () => {
  const created = await call("create_person", {
    productId: demoId(10),
    name: "Fictional summary preservation",
    review: false,
  });
  const original = await call("get_person", { personId: created.personId });
  const saved = await call("update_person", {
    personId: created.personId,
    version: original.person.version,
    name: "Fictional summary preservation",
    summary: "Fictional notes to preserve.",
  });
  const renamed = await call("update_person", {
    personId: created.personId,
    version: saved.version,
    name: "Fictional renamed contact",
  });
  expect(renamed.summary).toBe("Fictional notes to preserve.");
  const replaced = await call("update_person", {
    personId: created.personId,
    version: renamed.version,
    name: renamed.name,
    summary: "Fictional replacement notes.",
  });
  expect(replaced.summary).toBe("Fictional replacement notes.");
  const cleared = await call("update_person", {
    personId: created.personId,
    version: replaced.version,
    name: renamed.name,
    summary: "",
  });
  expect(cleared.summary).toBe("");
});
test("MCP removes duplicate deals from active forecasts and restores their original values", async () => {
  const product = await call("create_product", {
    name: "Fictional duplicate removal",
  });
  const person = await call("create_person", {
    productId: product.id,
    name: "Fictional deal customer",
    review: false,
  });
  const workspace = await call("get_workspace", { productId: product.id });
  const stage = workspace.stages.find(
    (row: { category: string }) => row.category === "open",
  );
  const deal = await call("save_deal", {
    productId: product.id,
    relationshipId: person.relationshipId,
    stageId: stage.id,
    name: "Fictional duplicate deal",
    ownerId: demoUser,
    amountMinor: 10000,
    currency: "USD",
    probability: 50,
    description: "Fictional retained deal history",
  });
  expect(
    (await call("get_overview", { productId: product.id })).weightedValue,
  ).toEqual([{ currency: "USD", amountMinor: 5000, count: 1 }]);
  const removed = await call("delete_deal", {
    productId: product.id,
    opportunityId: deal.id,
    version: deal.version,
  });
  expect(removed.archivedAt).toBeTruthy();
  expect(removed).toMatchObject({
    name: deal.name,
    amountMinor: deal.amountMinor,
    currency: deal.currency,
    probability: deal.probability,
    status: deal.status,
    stageId: deal.stageId,
    description: deal.description,
    version: deal.version + 1,
  });
  const archived = await call("get_workspace", { productId: product.id });
  expect(archived.opportunities).toHaveLength(0);
  expect(
    archived.archivedOpportunities.map((row: { id: string }) => row.id),
  ).toEqual([deal.id]);
  expect(
    (
      await call("list_records", {
        productId: product.id,
        entity: "opportunities",
      })
    ).total,
  ).toBe(0);
  expect(
    (await call("get_overview", { productId: product.id })).weightedValue,
  ).toEqual([]);
  expect(
    (
      await call("get_person_context", {
        relationshipId: person.relationshipId,
      })
    ).opportunities,
  ).toHaveLength(0);
  expect(
    (
      await call(
        "get_workspace",
        { productId: product.id },
        { ...writable, readOnly: true },
      )
    ).archivedOpportunities,
  ).toEqual([]);
  expect(
    (
      await call("delete_deal", {
        productId: product.id,
        opportunityId: deal.id,
        version: deal.version,
      })
    ).error,
  ).toContain("CONFLICT");
  const restored = await call("restore_deal", {
    productId: product.id,
    opportunityId: deal.id,
    version: removed.version,
  });
  expect(restored).toMatchObject({
    archivedAt: null,
    status: "open",
    stageId: deal.stageId,
    amountMinor: 10000,
    probability: 50,
    description: deal.description,
    version: removed.version + 1,
  });
  expect(
    (await call("get_overview", { productId: product.id })).weightedValue,
  ).toEqual([{ currency: "USD", amountMinor: 5000, count: 1 }]);
});
test("MCP publishes instructions, workflow prompts and an effective operation permission audit", async () => {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "agent-guide-test", version: "1.0.0" },
  });
  expect(initialized.result.instructions).toContain("get_permission_audit");
  expect(initialized.result.instructions).toContain("idempotencyKey");
  expect(initialized.result.instructions).not.toMatch(/not implemented\.$/);
  expect(initialized.result.instructions).not.toContain(
    "member administration are not implemented",
  );
  for (const phrase of [
    "all-products grant",
    "invitations",
    "Granting access",
    "accept_invitation",
    "resolve_delivery",
    "includeArchived",
  ])
    expect(initialized.result.instructions).toContain(phrase);
  const prompts = await rpc("prompts/list", {});
  expect(
    prompts.result.prompts.map((prompt: { name: string }) => prompt.name),
  ).toEqual([
    "daily-triage",
    "manage-sequence",
    "configure-connections",
    "send-approved-message",
  ]);
  const prompt = await rpc("prompts/get", { name: "send-approved-message" });
  expect(prompt.result.messages[0].content.text).toContain("send_touch");
  const guide = await rpc("resources/read", { uri: "gravity://agent-guide" });
  expect(guide.result.contents[0].text).toContain("untrusted data");
  const audit = await call(
    "get_permission_audit",
    {},
    { ...writable, canSend: true },
  );
  expect(audit.permissions).toContain("crm:send");
  expect(audit.operations).toHaveLength(operations.length);
  expect(
    audit.operations.find(
      (item: { name: string }) => item.name === "send_action",
    ),
  ).toMatchObject({
    available: true,
    requirements: {
      scopes: ["crm:read", "crm:write", "crm:send"],
      currentAccountOrSourceOwner: true,
    },
  });
  const restricted = await call(
    "get_permission_audit",
    {},
    { ...writable, productIds: [demoId(11)] },
  );
  expect(
    restricted.operations.find(
      (item: { name: string }) => item.name === "create_product",
    ).available,
  ).toBe(false);
  expect(
    restricted.operations.find(
      (item: { name: string }) => item.name === "configure_unipile",
    ).available,
  ).toBe(false);
  for (const name of ["list_unipile_accounts", "register_unipile_webhooks"]) {
    expect(
      restricted.operations.find(
        (item: { name: string }) => item.name === name,
      ),
    ).toMatchObject({
      available: false,
      requirements: {
        allProducts: true,
        currentAccountOrSourceOwner: true,
      },
    });
  }
  expect(
    restricted.operations.find(
      (item: { name: string }) => item.name === "send_action",
    ).available,
  ).toBe(false);
  const resource = await rpc("resources/read", {
    uri: "gravity://permissions",
  });
  expect(JSON.parse(resource.result.contents[0].text).operations).toHaveLength(
    operations.length,
  );
});
test("ordinary CRM write permission cannot perform outbound sending", async () => {
  const blocked = await call("send_touch", {
    touchId: demoId(990),
    connectionId: demoId(991),
    version: 1,
    idempotencyKey: "stable-key-without-permission",
  });
  expect(blocked.error).toMatch(/send_touch/);
  expect(blocked.result).toBeUndefined();
});
test("each assistant scope combination lists only its tools and refuses the rest", async () => {
  const sendNames = operations
    .filter((item) => item.permission === "crm:send")
    .map((item) => item.name);
  const writeNames = operations
    .filter((item) => item.method !== "GET" && !item.permission)
    .map((item) => item.name);
  const readNames = operations
    .filter((item) => item.method === "GET")
    .map((item) => item.name);
  expect(sendNames).toEqual([
    "send_touch",
    "send_action",
    "reconcile_delivery",
  ]);
  const humanNames = operations
    .filter((item) => operationRequirements(item).humanSession)
    .map((item) => item.name);
  expect(humanNames.sort()).toEqual([
    "accept_invitation",
    "create_invitation",
    "preview_invitation",
    "reactivate_member",
    "resolve_delivery",
  ]);
  const resolve = operations.find((item) => item.name === "resolve_delivery");
  if (!resolve) throw new Error("resolve_delivery missing");
  expect(operationRequirements(resolve)).toMatchObject({
    administrator: true,
    allProducts: true,
    humanSession: true,
  });
  const listed = async (principal: Principal) =>
    (await rpc("tools/list", {}, principal)).result.tools.map(
      (tool: { name: string }) => tool.name,
    );
  const reader = { ...writable, readOnly: true, canSend: false };
  const writer = { ...writable, readOnly: false, canSend: false };
  const sender = { ...writable, readOnly: false, canSend: true };
  const readTools = await listed(reader);
  expect(readTools).toEqual(expect.arrayContaining(readNames));
  for (const name of [...writeNames, ...sendNames])
    expect(readTools).not.toContain(name);
  const writeTools = await listed(writer);
  expect(writeTools).toEqual(
    expect.arrayContaining(
      [...readNames, ...writeNames].filter(
        (name) => !humanNames.includes(name),
      ),
    ),
  );
  for (const name of sendNames) expect(writeTools).not.toContain(name);
  const machineNames = (names: string[]) =>
    names.filter((name) => !humanNames.includes(name));
  const senderTools = await listed(sender);
  expect(senderTools).toEqual(
    expect.arrayContaining(
      machineNames([...readNames, ...writeNames, ...sendNames]),
    ),
  );
  for (const tools of [readTools, writeTools, senderTools])
    for (const name of humanNames) expect(tools).not.toContain(name);
  const draft = {
    name: "Scope refusal fixture",
    productId: demoId(11),
    email: "scope-refusal@example.test",
  };
  expect((await call("create_person", draft, reader)).error).toMatch(
    /create_person/,
  );
  const sendInput = {
    touchId: demoId(990),
    connectionId: demoId(991),
    version: 1,
    idempotencyKey: "stable-key-for-scope-refusal",
  };
  expect((await call("send_touch", sendInput, writer)).error).toMatch(
    /send_touch/,
  );
  expect((await call("send_touch", sendInput, sender)).error).not.toMatch(
    /SEND_PERMISSION_REQUIRED|not found/i,
  );
});

test("MCP rejects approved review tasks before creating a delivery", async () => {
  const person = await call("create_person", {
    productId: demoId(10),
    name: "Fictional review task contact",
    review: false,
  });
  const action = await call("schedule_next_action", {
    relationshipId: person.relationshipId,
    ownerId: demoUser,
    kind: "review",
    channel: "gmail",
    owedBy: "us",
    title: "Review the existing history",
    dueAt: new Date().toISOString(),
  });
  const approved = await call("change_action", {
    actionId: action.actionId,
    version: 1,
    command: "approve",
    draft: "Subject: Fictional review\n\nUnsent fixture.",
  });
  const [connection] = await local.db
    .insert(s.connections)
    .values({
      organizationId: demoId(1),
      productId: demoId(10),
      ownerId: demoUser,
      provider: "gmail",
      externalAccountId: "mcp-review-fixture",
      status: "connected",
    })
    .returning();
  if (!connection) throw new Error("missing connection fixture");
  const input = {
    actionId: action.actionId,
    connectionId: connection.id,
    version: approved.version,
  };
  const sender = { ...writable, canSend: true };
  expect(await call("get_send_readiness", input, sender)).toMatchObject({
    ready: false,
    approved: true,
    blockedBy: "SOURCE_NOT_SENDABLE",
  });
  expect(
    (
      await call(
        "send_action",
        { ...input, idempotencyKey: "mcp-review-no-dispatch" },
        sender,
      )
    ).error,
  ).toContain("SOURCE_NOT_SENDABLE");
  expect(
    await local.db
      .select()
      .from(s.deliveries)
      .where(eq(s.deliveries.actionId, action.actionId)),
  ).toHaveLength(0);
});

test("MCP preserves imported context while recording estimates separately from actual deal revenue", async () => {
  const product = await call("create_product", {
    name: "Fictional revenue review product",
  });
  const source = JSON.stringify({
    history: "Fictional legacy review",
    send_permission: false,
  });
  const person = await call("create_person", {
    productId: product.id,
    name: "Fictional revenue review contact",
    context: source,
    review: false,
  });
  const context = await call("get_person_context", {
    relationshipId: person.relationshipId,
  });
  const estimated = await call("update_record_metadata", {
    entity: "person",
    recordId: person.personId,
    version: context.person.version,
    tags: ["reviewed"],
    amountMinor: 9000000,
    currency: "USD",
  });
  expect(estimated).toMatchObject({
    entity: "person",
    record: { amountMinor: 9000000 },
  });
  const edited = await call("change_relationship", {
    relationshipId: person.relationshipId,
    version: context.relationship.version,
    context: "Readable fictional summary",
    contextDetails: { budget: "Budget remains unverified." },
  });
  expect(edited).toMatchObject({ contextSource: source });
  const workspace = await call("get_workspace", { productId: product.id });
  const stage = workspace.stages.find(
    (item: { category: string }) => item.category === "open",
  );
  if (!stage) throw new Error("missing sales stage fixture");
  const deal = await call("save_deal", {
    productId: product.id,
    relationshipId: person.relationshipId,
    stageId: stage.id,
    name: "Fictional quoted deal",
    ownerId: demoUser,
    amountMinor: 123456,
    currency: "USD",
    probability: 40,
    expectedCloseDate: "2030-02-03",
    description: "Reviewed fictional quote",
  });
  expect(deal).toMatchObject({ amountMinor: 123456, probability: 40 });
  const report = await call("get_overview", { productId: product.id });
  expect(report.weightedValue).toEqual([
    { currency: "USD", amountMinor: 49382, count: 1 },
  ]);
  const refreshed = await call("get_person_context", {
    relationshipId: person.relationshipId,
  });
  expect(refreshed.relationship.contextSource).toBe(source);
  expect(refreshed.person.tags).toEqual(["reviewed"]);
  expect(refreshed.messages).toHaveLength(0);
  const compact = await call("get_workspace", {
    productId: product.id,
    compact: "true",
  });
  expect(compact.compact).toBe(true);
  expect(compact.relationships[0].context).toBe("");
  expect(compact.relationships[0]).not.toHaveProperty("contextSource");
  expect(compact.relationships[0]).not.toHaveProperty("contextDetails");
  expect(compact.people[0].tags).toEqual(["reviewed"]);
  expect(compact.opportunities[0]).toMatchObject({
    amountMinor: 123456,
    probability: 40,
    version: deal.version,
  });
});

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

test("MCP edits and archives complete client/company records with HTTP refinements and version checks", async () => {
  const company = await call("save_company", {
    name: "Fictional MCP Company",
    domain: "https://www.fictional.example.test/path",
  });
  expect(company.domain).toBe("fictional.example.test");
  expect(
    (
      await call("save_company", {
        companyId: company.id,
        name: "Missing version",
      })
    ).error,
  ).toBeTruthy();
  const created = await call("create_person", {
    productId: demoId(11),
    companyId: company.id,
    name: "Fictional Editable Client",
    review: false,
  });
  const original = await call("get_person", { personId: created.personId });
  expect(original.person.companyId).toBe(company.id);
  const args = {
    personId: created.personId,
    version: original.person.version,
    name: "Fictional Updated Client",
    email: "fictional-mcp@example.test",
    title: "Founder",
    phone: "+1 555 0100",
    summary: "Fictional client history",
    companyId: company.id,
  };
  const updated = await call("update_person", {
    ...args,
    organizationId: demoId(2),
  });
  expect(updated).toMatchObject({
    name: args.name,
    email: args.email,
    organizationId: demoId(1),
    version: args.version + 1,
  });
  expect((await call("update_person", args)).error).toContain("CONFLICT");
  const paged = await call("list_records", {
    entity: "people",
    query: args.name,
    limit: 1,
  });
  expect(paged.total).toBe(1);
  expect(paged.items[0].id).toBe(created.personId);
  const archived = await call("archive_person", {
    personId: created.personId,
    version: updated.version,
    archived: true,
  });
  expect(archived.archivedAt).toBeTruthy();
  expect(
    (await call("get_person", { personId: created.personId })).person.version,
  ).toBe(archived.version);
  expect(
    (await call("list_records", { entity: "people", query: args.name })).total,
  ).toBe(0);
  const restored = await call("archive_person", {
    personId: created.personId,
    version: archived.version,
    archived: false,
  });
  expect(restored.archivedAt).toBeNull();
  expect(
    (await call("get_company_context", { companyId: company.id })).company.id,
  ).toBe(company.id);
});

test("MCP manages sequences and outreach drafts, including approvals, stale writes, pause and stop", async () => {
  const steps = [
    {
      number: 1,
      name: "First touch",
      delayDays: 0,
      channel: "gmail",
      template: "Hello {{firstName}}",
      followUp: 0,
    },
    {
      number: 2,
      name: "Follow up",
      delayDays: 2,
      channel: "gmail",
      template: "Checking in",
      followUp: 1,
    },
  ];
  expect(
    (
      await call("create_sequence", {
        productId: demoId(11),
        name: "Invalid sequence",
        steps: [steps[0], steps[0]],
      })
    ).error,
  ).toBeTruthy();
  const sequence = await call("create_sequence", {
    productId: demoId(11),
    name: "Fictional MCP Sequence",
    steps: [...steps].reverse(),
  });
  expect(sequence.steps.map((step: { number: number }) => step.number)).toEqual(
    [1, 2],
  );
  const updated = await call("update_sequence", {
    sequenceId: sequence.id,
    version: sequence.version,
    name: "Fictional Updated Sequence",
    steps,
  });
  expect(updated.error).toBeUndefined();
  expect(updated.sequence.version).toBe(sequence.version + 1);
  expect(
    (
      await call("update_sequence", {
        sequenceId: sequence.id,
        version: sequence.version,
        steps,
      })
    ).error,
  ).toContain("CONFLICT");
  const person = await call("create_person", {
    productId: demoId(11),
    name: "Fictional Sequence Client",
    email: "sequence-mcp@example.test",
    review: false,
  });
  const preview = await call("enroll_in_sequence", {
    sequenceId: sequence.id,
    relationshipIds: [person.relationshipId],
    dryRun: true,
  });
  expect(preview.enrolled).toHaveLength(1);
  expect(
    (await call("get_sequence", { sequenceId: sequence.id })).enrollments,
  ).toHaveLength(0);
  const enrolled = await call("enroll_in_sequence", {
    sequenceId: sequence.id,
    relationshipIds: [person.relationshipId],
  });
  expect(enrolled.enrolled).toHaveLength(1);
  const enrollmentId = enrolled.enrolled[0].enrollmentId;
  await call("advance_sequences", { productId: demoId(11) });
  const [touch] = await local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.enrollmentId, enrollmentId));
  expect(touch).toBeTruthy();
  const draft = await call("edit_touch_draft", {
    touchId: touch.id,
    version: touch.version,
    draft: "Fictional approved draft",
  });
  const approved = await call("approve_touch", {
    touchId: touch.id,
    version: draft.version,
  });
  expect(approved.approvedBy).toBe(demoUser);
  expect(approved.approvedHash).toBe(approved.draftHash);
  expect(
    (await call("approve_touch", { touchId: touch.id, version: draft.version }))
      .error,
  ).toContain("CONFLICT");
  const edited = await call("edit_touch_draft", {
    touchId: touch.id,
    version: approved.version,
    draft: "Changed fictional draft",
  });
  expect(edited.approvedHash).toBeNull();
  const skipped = await call("skip_touch", {
    touchId: touch.id,
    version: edited.version,
    reason: "Fictional test",
  });
  expect(skipped.status).toBe("skipped");
  const reopened = await call("reopen_touch", {
    touchId: touch.id,
    version: skipped.version,
  });
  expect(reopened.status).toBe("drafted");
  const detail = await call("get_sequence", { sequenceId: sequence.id });
  const enrollment = detail.enrollments[0];
  const paused = await call("change_enrollment", {
    enrollmentId,
    version: enrollment.version,
    command: "pause",
  });
  expect(paused.status).toBe("paused");
  expect(
    (
      await call("approve_touch", {
        touchId: touch.id,
        version: reopened.version,
      })
    ).error,
  ).toContain("ENROLLMENT_PAUSED");
  const stopped = await call("change_enrollment", {
    enrollmentId,
    version: paused.version,
    command: "stop",
  });
  expect(stopped.status).toBe("stopped");
});

test("MCP can upload contract PDFs and download exact bytes without crossing product permissions", async () => {
  const folder = await call("create_material_folder", {
    productId: demoId(11),
    name: "Fictional contracts",
  });
  const dataBase64 = Buffer.from(
    "%PDF-1.7\nFictional contract\n%%EOF",
  ).toString("base64");
  const input = {
    productId: demoId(11),
    folderId: folder.id,
    name: "Fictional contract.pdf",
    mimeType: "application/pdf",
    dataBase64,
  };
  expect(
    (await call("upload_material", { ...input, dataBase64: "not base64" }))
      .error,
  ).toContain("INVALID_INPUT");
  const asset = await call("upload_material", input);
  expect(asset.error).toBeUndefined();
  const file = await call("download_material", { assetId: asset.id });
  expect(file.mimeType).toBe("application/pdf");
  expect(file.dataBase64).toBe(dataBase64);
  expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(
    (
      await call(
        "download_material",
        { assetId: asset.id },
        { ...writable, productIds: [demoId(10)] },
      )
    ).error,
  ).toContain("FORBIDDEN");
  expect(
    (
      await call("upload_material", {
        ...input,
        mimeType: "application/pdf",
        dataBase64: Buffer.from("not a pdf").toString("base64"),
      })
    ).error,
  ).toContain("FILE_TYPE");
});

test("MCP supports atomic follow-up planning and new workspaces without silently widening its grant", async () => {
  const person = await call("create_person", {
    productId: demoId(11),
    name: "Fictional Plan Client",
    review: false,
  });
  const input = {
    relationshipId: person.relationshipId,
    ownerId: demoUser,
    kind: "research",
    channel: "research",
    owedBy: "us",
    dueAt: new Date().toISOString(),
  };
  const first = await call("schedule_next_action", {
    ...input,
    title: "Fictional first",
  });
  const second = await call("schedule_next_action", {
    ...input,
    title: "Fictional second",
  });
  const stale = await call("plan_actions", {
    items: [
      { actionId: first.actionId, version: 1, status: "completed" },
      { actionId: second.actionId, version: 99, status: "completed" },
    ],
  });
  expect(stale.error).toContain("CONFLICT");
  const before = await service.snapshot(writable, {
    organizationId: demoId(1),
  });
  expect(before.actions.find((row) => row.id === first.actionId)?.status).toBe(
    "open",
  );
  expect(
    (
      await call("plan_actions", {
        items: [
          { actionId: first.actionId, version: 1, status: "completed" },
          { actionId: second.actionId, version: 1, status: "completed" },
        ],
      })
    ).error,
  ).toBeUndefined();
  const workspace = await call("create_workspace", {
    name: "Fictional MCP Workspace",
    productName: "Fictional Product",
    timezone: "UTC",
  });
  expect(workspace.organizationId).toBeTruthy();
  expect(
    (
      await call("create_person", {
        productId: workspace.productId,
        name: "Unconsented workspace",
      })
    ).error,
  ).toContain("FORBIDDEN");
  expect(
    (await call("list_organizations")).map((row: { id: string }) => row.id),
  ).toEqual([demoId(1)]);
  expect(
    (
      await call(
        "create_organization",
        { name: "Forbidden" },
        { ...writable, productIds: [demoId(11)] },
      )
    ).error,
  ).toContain("FORBIDDEN");
});

test("MCP account management uses owner isolation, encrypted personal credentials and provider consent", async () => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("APP_URL", "https://gravity.example.test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "fictional-google-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fictional-google-secret");
  const transport = vi.fn<typeof fetch>(async (url) =>
    Response.json(
      String(url).includes("/auth/link")
        ? { link: "https://auth.unipile.com/fictional-auth" }
        : { data: [] },
    ),
  );
  vi.stubGlobal("fetch", transport);
  try {
    const credentials = {
      apiKey: "fictional-private-unipile-key",
      signingSecret: "fictional-private-signing-secret",
    };
    expect(
      (
        await call("configure_unipile", credentials, {
          ...writable,
          productIds: [demoId(11)],
        })
      ).error,
    ).toContain("FORBIDDEN");
    const configured = await call("configure_unipile", credentials);
    expect(configured.webhookReady).toBe(true);
    expect(JSON.stringify(configured)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(configured)).not.toContain(credentials.signingSecret);
    const overview = await call("get_integrations", { productId: demoId(11) });
    expect(JSON.stringify(overview)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(overview)).not.toContain(credentials.signingSecret);
    const other = await call(
      "get_integrations",
      { productId: demoId(11) },
      { ...writable, userId: "demo-teammate" },
    );
    expect(other.unipileConfiguration).toBeNull();
    const google = await call("connect_integration", {
      provider: "gmail",
      productId: demoId(11),
    });
    const url = new URL(google.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://gravity.example.test/api/integrations/callback/google",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const linkedin = await call("connect_integration", {
      provider: "linkedin",
      productId: demoId(11),
    });
    expect(linkedin.url).toBe("https://auth.unipile.com/fictional-auth");
    const [owned] = await local.db
      .insert(s.connections)
      .values({
        organizationId: demoId(1),
        productId: demoId(11),
        provider: "gmail",
        ownerId: demoUser,
        externalAccountId: "fictional-account",
        status: "connected",
      })
      .returning();
    expect(
      (
        await call(
          "disconnect_integration",
          { connectionId: owned.id },
          { ...writable, userId: "demo-teammate" },
        )
      ).error,
    ).toContain("NOT_FOUND");
    const disconnected = await call("disconnect_integration", {
      connectionId: owned.id,
    });
    expect(disconnected.error).toBeUndefined();
    await call("remove_unipile", { configurationId: configured.id });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("MCP may revoke its own assistant grant but never a teammate's or another organization's grant", async () => {
  const [own] = await local.db
    .insert(s.mcpGrants)
    .values({ userId: demoUser, organizationId: demoId(1), productIds: ["*"] })
    .returning();
  const [foreign] = await local.db
    .insert(s.mcpGrants)
    .values({
      userId: "demo-teammate",
      organizationId: demoId(1),
      productIds: ["*"],
    })
    .returning();
  const [otherOrg] = await local.db
    .insert(s.mcpGrants)
    .values({ userId: demoUser, organizationId: demoId(2), productIds: ["*"] })
    .returning();
  expect(
    (await call("revoke_assistant", { grantId: foreign.id })).error,
  ).toContain("NOT_FOUND");
  expect(
    (await call("revoke_assistant", { grantId: otherOrg.id })).error,
  ).toContain("NOT_FOUND");
  expect(await call("revoke_assistant", { grantId: own.id })).toEqual({
    revoked: true,
  });
  await expect(
    principalForGrant(local.db, demoUser, own.id),
  ).rejects.toMatchObject({ status: 403 });
});

test("MCP contact policies require current versions and organization-wide grants", async () => {
  const before = await call("get_contact_rules");
  const input = {
    version: before.version,
    cooldownDays: 3,
    dailyCapPerSender: 25,
    quietHoursStart: 19,
    quietHoursEnd: 8,
  };
  expect(
    (
      await call("update_contact_rules", input, {
        ...writable,
        productIds: [demoId(11)],
      })
    ).error,
  ).toContain("FORBIDDEN");
  expect(
    (
      await call("update_contact_rules", input, {
        ...writable,
        userId: "demo-teammate",
      })
    ).error,
  ).toContain("FORBIDDEN");
  const updated = await call("update_contact_rules", input);
  expect(updated.error).toBeUndefined();
  expect((await call("get_contact_rules")).dailyCapPerSender).toBe(25);
  expect((await call("update_contact_rules", input)).error).toContain(
    "CONFLICT",
  );
  const created = await call("create_person", {
    productId: demoId(11),
    name: "Fictional Opt-out Client",
    review: false,
  });
  const context = await call("get_person", { personId: created.personId });
  const prefs = {
    personId: created.personId,
    version: context.person.version,
    doNotContact: true,
    timeZone: "Asia/Kolkata",
  };
  const optedOut = await call("set_contact_preferences", prefs);
  expect(optedOut).toMatchObject({
    doNotContact: true,
    timeZone: "Asia/Kolkata",
  });
  expect((await call("set_contact_preferences", prefs)).error).toContain(
    "CONFLICT",
  );
});

test("MCP exposes typed relationship context and edits it without crm:send", async () => {
  const created = await call("create_person", {
    productId: demoId(10),
    name: "MCP context fixture",
    review: false,
  });
  const context = await call("get_person_context", {
    relationshipId: created.relationshipId,
  });
  const listing = await rpc("tools/list", {});
  const tool = listing.result.tools.find(
    (item: { name: string }) => item.name === "change_relationship",
  );
  expect(tool.inputSchema.properties.context).toBeTruthy();
  expect(
    tool.inputSchema.properties.contextDetails.properties.signals,
  ).toBeTruthy();
  const args = {
    productId: demoId(10),
    relationshipId: created.relationshipId,
    version: context.relationship.version,
    context: "Readable MCP notes",
    contextDetails: {
      needs: "Fictional requirement",
      fields: [
        { id: demoId(8900), label: "Target seats", type: "number", value: 25 },
      ],
    },
  };
  const edited = await call("change_relationship", args);
  expect(edited.contextDetails.fields[0].value).toBe(25);
  expect(edited.context).toBe("Readable MCP notes");
  expect((await call("change_relationship", args)).error).toContain("CONFLICT");
  expect(
    (
      await call(
        "change_relationship",
        { ...args, version: edited.version },
        { ...writable, readOnly: true },
      )
    ).error,
  ).toBeTruthy();
  expect(
    (
      await call(
        "change_relationship",
        { ...args, version: edited.version },
        { ...writable, productIds: [demoId(11)] },
      )
    ).error,
  ).toContain("FORBIDDEN");
  expect(
    (
      await call("get_person_context", {
        relationshipId: created.relationshipId,
      })
    ).relationship.contextDetails.needs,
  ).toBe("Fictional requirement");
});
test("assistants may tighten contact safety but loosening it is human-only", async () => {
  const human: Principal = { userId: demoUser, source: "session" };
  const outreach = new OutreachService(local.db);
  const start = await outreach.contactRules(human, demoId(1));
  const baseline = await outreach.updateContactRules(human, {
    organizationId: demoId(1),
    version: start.version,
    cooldownDays: 5,
    dailyCapPerSender: 30,
    quietHoursStart: 20,
    quietHoursEnd: 8,
  });
  const base = {
    version: baseline.version,
    cooldownDays: 5,
    dailyCapPerSender: 30,
    quietHoursStart: 20,
    quietHoursEnd: 8,
  };
  for (const looser of [
    { dailyCapPerSender: 31 },
    { cooldownDays: 4 },
    { quietHoursStart: 21 },
    { quietHoursEnd: 7 },
    { quietHoursStart: 8, quietHoursEnd: 8 },
    { quietHoursStart: 22, quietHoursEnd: 9 },
  ])
    expect(
      (await call("update_contact_rules", { ...base, ...looser })).error,
      JSON.stringify(looser),
    ).toContain("HUMAN_ACTION_REQUIRED");
  expect((await outreach.contactRules(human, demoId(1))).version).toBe(
    baseline.version,
  );
  const tightened = await call("update_contact_rules", {
    ...base,
    cooldownDays: 6,
    dailyCapPerSender: 20,
    quietHoursStart: 19,
    quietHoursEnd: 9,
  });
  expect(tightened).toMatchObject({
    cooldownDays: 6,
    dailyCapPerSender: 20,
    quietHoursStart: 19,
    quietHoursEnd: 9,
  });
  const relaxed = await outreach.updateContactRules(human, {
    organizationId: demoId(1),
    version: tightened.version,
    cooldownDays: 3,
    dailyCapPerSender: 40,
    quietHoursStart: 20,
    quietHoursEnd: 8,
  });
  expect(relaxed.dailyCapPerSender).toBe(40);
  const created = await call("create_person", {
    productId: demoId(11),
    name: "Fictional Safety Client",
    review: false,
  });
  const before = await call("get_person", { personId: created.personId });
  const optedOut = await call("set_contact_preferences", {
    personId: created.personId,
    version: before.person.version,
    doNotContact: true,
    timeZone: null,
  });
  expect(optedOut.doNotContact).toBe(true);
  expect(
    (
      await call("set_contact_preferences", {
        personId: created.personId,
        version: optedOut.version,
        doNotContact: false,
        timeZone: null,
      })
    ).error,
  ).toContain("HUMAN_ACTION_REQUIRED");
  const cleared = await outreach.setContactPreferences(human, {
    organizationId: demoId(1),
    personId: created.personId,
    version: optedOut.version,
    doNotContact: false,
    timeZone: null,
  });
  expect(cleared.doNotContact).toBe(false);
});
test("an assistant cannot change where a do-not-contact person is reached", async () => {
  const created = await call("create_person", {
    productId: demoId(11),
    name: "Fictional Opted Out Client",
    email: "opted-out@example.test",
    review: false,
  });
  const before = await call("get_person", { personId: created.personId });
  const optedOut = await call("set_contact_preferences", {
    personId: created.personId,
    version: before.person.version,
    doNotContact: true,
    timeZone: null,
  });
  const base = {
    personId: created.personId,
    version: optedOut.version,
    name: "Fictional Opted Out Client",
    email: "opted-out@example.test",
    otherEmails: [],
    linkedinUrl: "",
  };
  for (const change of [
    { email: "new-route@example.test" },
    { otherEmails: ["second-route@example.test"] },
    { linkedinUrl: "https://www.linkedin.com/in/opted-out-fixture/" },
  ])
    expect(
      (await call("update_person", { ...base, ...change })).error,
    ).toContain("HUMAN_ACTION_REQUIRED");
  const renamed = await call("update_person", {
    ...base,
    name: "Fictional Renamed Client",
  });
  expect(renamed.name).toBe("Fictional Renamed Client");
  const edited = await new RecordService(local.db).updatePerson(
    { userId: demoUser, source: "session" },
    {
      organizationId: demoId(1),
      ...base,
      version: renamed.version,
      name: renamed.name,
      title: "",
      phone: "",
      summary: "",
      email: "new-route@example.test",
    },
  );
  expect(edited.email).toBe("new-route@example.test");
});
