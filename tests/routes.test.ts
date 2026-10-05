import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { seal } from "../packages/connectors/security";
import type { Principal } from "../packages/core/policy";
import { DomainError } from "../packages/core/policy";
import type { Database } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let db: Database;
let demo = false;
vi.mock("@crm/database/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDatabase: async () => db,
  isDemoMode: () => demo,
}));
// Route tests inject identity, not authorization. Policies, transactions and constraints run in SQL.
vi.mock("@crm/auth/server", () => ({
  currentPrincipal: async (headers: Headers): Promise<Principal> => {
    const userId = headers.get("x-test-user");
    if (!userId) throw new DomainError("UNAUTHORIZED", 401);
    return { userId, source: "session" };
  },
  assertMutationOrigin: (request: Request) => {
    if (request.headers.get("origin") !== "http://localhost")
      throw new DomainError("FORBIDDEN", 403);
  },
}));

import { GET, POST } from "../src/app/api/crm/route";
import { POST as webhook } from "../src/app/api/webhooks/unipile/route";

let local: Awaited<
  ReturnType<
    typeof import("../packages/database/client")["createLocalDatabase"]
  >
>;
const secret = "fictional-route-test-secret";
beforeAll(async () => {
  const module = await vi.importActual<
    typeof import("../packages/database/client")
  >("../packages/database/client");
  local = await module.createLocalDatabase();
  db = local.db;
  await seedDemo(db);
  vi.stubEnv("UNIPILE_WEBHOOK_SECRET", secret);
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  await db.insert(s.providerConfigurations).values({
    id: demoId(990),
    organizationId: demoId(1),
    ownerId: demoUser,
    provider: "unipile",
    webhookReady: true,
    encryptedCredentials: seal(
      { apiKey: "fictional-route-api-key", signingSecret: secret },
      `${demoId(1)}:${demoUser}:${demoId(990)}:provider`,
    ),
  });
  await db
    .update(s.connections)
    .set({ providerConfigurationId: demoId(990) })
    .where(eq(s.connections.id, demoId(701)));
  // One provider account owns a Gmail channel independently of the LinkedIn account.
  await db
    .update(s.connections)
    .set({
      provider: "unipile",
      providerConfigurationId: demoId(990),
      externalAccountId: "route-gmail",
      selfEmail: "alex@example.test",
      inboxFolderIds: ["INBOX"],
      sentFolderIds: ["SENT"],
    })
    .where(eq(s.connections.id, demoId(700)));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await local.client.close();
});
function crm(body: object, user = demoUser, origin = "http://localhost") {
  return POST(
    new Request("http://localhost/api/crm", {
      method: "POST",
      headers: {
        origin,
        "x-test-user": user,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}
function read(query: string, user = demoUser) {
  return GET(
    new Request(`http://localhost/api/crm?${query}`, {
      headers: { "x-test-user": user },
    }),
  );
}
function linkedIn(
  id = randomUUID(),
  account = "demo-linkedin",
  thread = "demo-theo",
) {
  return {
    id: randomUUID(),
    account_id: account,
    account_provider: "LINKEDIN",
    type: "message.new",
    payload: {
      id,
      chat_id: thread,
      is_sender: false,
      is_event: false,
      text: "Fictional route test reply",
      timestamp: new Date().toISOString(),
    },
  };
}
function signed(
  payload: object,
  options: { stale?: boolean; tamper?: boolean } = {},
) {
  const raw = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000) - (options.stale ? 600 : 0);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  return new Request(
    `http://localhost/api/webhooks/unipile?configurationId=${demoId(990)}`,
    {
      method: "POST",
      headers: { "unipile-signature": `t=${timestamp},v0=${signature}` },
      body: options.tamper ? `${raw} ` : raw,
    },
  );
}
const events = () => db.select().from(s.connectorEvents);
describe("CRM HTTP contracts", () => {
  test("read routes reject missing identities, malformed operations and forbidden scopes", async () => {
    expect(
      (
        await GET(
          new Request(`http://localhost/api/crm?organizationId=${demoId(1)}`),
        )
      ).status,
    ).toBe(401);
    expect(
      (await read(`organizationId=${demoId(1)}&operation=typo`)).status,
    ).toBe(400);
    expect((await read("organizationId=invalid")).status).toBe(400);
    expect(
      (await read(`organizationId=${demoId(2)}`, "demo-teammate")).status,
    ).toBe(403);
    expect(
      (
        await read(
          `organizationId=${demoId(1)}&productId=${demoId(10)}`,
          "demo-restricted",
        )
      ).status,
    ).toBe(403);
    const response = await read(
      `organizationId=${demoId(1)}&productId=${demoId(11)}`,
      "demo-restricted",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(
      data.relationships.every(
        (row: { productId: string }) => row.productId === demoId(11),
      ),
    ).toBe(true);
  });
  test("product creation is admin-only, transactional and reports duplicates for correction", async () => {
    const body = {
      operation: "product",
      organizationId: demoId(1),
      name: "Fictional HTTP Product",
    };
    expect((await crm(body, "demo-teammate")).status).toBe(403);
    expect((await crm(body, demoUser, "http://untrusted.example")).status).toBe(
      403,
    );
    const first = await crm(body);
    expect(first.status).toBe(200);
    const product = await first.json();
    expect(
      await db
        .select()
        .from(s.stages)
        .where(eq(s.stages.productId, product.id)),
    ).toHaveLength(4);
    expect(
      await db
        .select()
        .from(s.folders)
        .where(eq(s.folders.productId, product.id)),
    ).toHaveLength(1);
    const duplicate = await crm(body);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: "PRODUCT_EXISTS" });
    expect(
      await db
        .select()
        .from(s.products)
        .where(
          and(
            eq(s.products.organizationId, demoId(1)),
            eq(s.products.name, body.name),
          ),
        ),
    ).toHaveLength(1);
  });
  test("a filtered view can load full permitted choices and schedule on a different product", async () => {
    const filtered = await (
      await read(`organizationId=${demoId(1)}&productId=${demoId(10)}`)
    ).json();
    const complete = await (await read(`organizationId=${demoId(1)}`)).json();
    expect(
      filtered.relationships.some((r: { id: string }) => r.id === demoId(302)),
    ).toBe(false);
    expect(
      complete.relationships.some((r: { id: string }) => r.id === demoId(302)),
    ).toBe(true);
    const response = await crm({
      operation: "schedule",
      organizationId: demoId(1),
      productId: demoId(12),
      relationshipId: demoId(302),
      ownerId: demoUser,
      kind: "review",
      channel: "gmail",
      owedBy: "us",
      title: "Fictional cross-product task",
      dueAt: new Date().toISOString(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      relationshipId: demoId(302),
      productId: demoId(12),
    });
  });
});
describe("signed integration HTTP contracts", () => {
  test("tampered, stale and missing signatures fail before any SQL write", async () => {
    const before = await events();
    expect((await webhook(signed(linkedIn(), { tamper: true }))).status).toBe(
      401,
    );
    expect((await webhook(signed(linkedIn(), { stale: true }))).status).toBe(
      401,
    );
    expect(
      (
        await webhook(
          new Request("http://localhost/api/webhooks/unipile", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
    expect(await events()).toHaveLength(before.length);
  });
  test("LinkedIn retries persist one message and invalidate pending work", async () => {
    const payload = linkedIn();
    expect((await webhook(signed(payload))).status).toBe(200);
    const duplicate = await webhook(signed(payload));
    expect(await duplicate.json()).toMatchObject({
      duplicate: true,
      matched: true,
    });
    const messages = await db
      .select()
      .from(s.messages)
      .where(eq(s.messages.providerMessageId, payload.payload.id));
    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe("inbound");
    const enrollment = await db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.relationshipId, demoId(303)));
    expect(enrollment.every((row) => row.status !== "running")).toBe(true);
    const approvals = await db
      .select()
      .from(s.actions)
      .where(
        and(
          eq(s.actions.relationshipId, demoId(303)),
          eq(s.actions.kind, "approval"),
        ),
      );
    expect(approvals.every((row) => row.approvedHash === null)).toBe(true);
  });
  test("Google mailbox delivery classifies sent mail and ignores archive moves", async () => {
    const mail = (folder: string, from: string) => ({
      id: randomUUID(),
      account_id: "route-gmail",
      account_provider: "GOOGLE",
      type: "email.new",
      payload: {
        folder_id: folder,
        email: {
          id: randomUUID(),
          thread_id: "demo-mira",
          body_plain: "Fictional Gmail event",
          date: new Date().toISOString(),
          from: [{ email: from }],
        },
      },
    });
    const outbound = mail("SENT", "alex@example.test");
    expect((await webhook(signed(outbound))).status).toBe(200);
    const [message] = await db
      .select()
      .from(s.messages)
      .where(eq(s.messages.providerMessageId, outbound.payload.email.id));
    expect(message.direction).toBe("outbound");
    const before = await events();
    expect(
      await (
        await webhook(signed(mail("ARCHIVE", "buyer@example.test")))
      ).json(),
    ).toEqual({ ignored: true });
    expect(await events()).toHaveLength(before.length);
    const inbound = mail("INBOX", "buyer@example.test");
    expect((await webhook(signed(inbound))).status).toBe(200);
    const [reply] = await db
      .select()
      .from(s.messages)
      .where(eq(s.messages.providerMessageId, inbound.payload.email.id));
    expect(reply.direction).toBe("inbound");
  });
  test("unknown accounts fail closed and a known account cannot claim another account's thread", async () => {
    expect(
      (await webhook(signed(linkedIn(randomUUID(), "unknown-account")))).status,
    ).toBe(422);
    const payload = linkedIn(randomUUID(), "demo-linkedin", "demo-mira");
    expect(await (await webhook(signed(payload))).json()).toMatchObject({
      matched: false,
    });
    expect(
      await db
        .select()
        .from(s.messages)
        .where(eq(s.messages.providerMessageId, payload.payload.id)),
    ).toHaveLength(0);
  });
  test("demo mode and missing connector secrets reject requests without ingestion", async () => {
    const before = await events();
    demo = true;
    try {
      expect((await webhook(signed(linkedIn()))).status).toBe(503);
    } finally {
      demo = false;
    }
    await db
      .update(s.providerConfigurations)
      .set({ webhookReady: false })
      .where(eq(s.providerConfigurations.id, demoId(990)));
    try {
      expect((await webhook(signed(linkedIn()))).status).toBe(401);
    } finally {
      await db
        .update(s.providerConfigurations)
        .set({ webhookReady: true })
        .where(eq(s.providerConfigurations.id, demoId(990)));
    }
    expect(await events()).toHaveLength(before.length);
  });
});

describe("workspace onboarding HTTP transaction", () => {
  test("creates scoped defaults and rejects invalid or unauthenticated setup", async () => {
    const body = {
      operation: "workspace",
      name: "Fictional onboarding",
      productName: "Pilot",
      timezone: "Asia/Kolkata",
      organizationId: demoId(2),
    };
    expect((await crm(body, "")).status).toBe(401);
    expect(
      (await crm(body, demoUser, "https://other.example.test")).status,
    ).toBe(403);
    const before = await db.select().from(s.organizations);
    expect((await crm({ ...body, timezone: "Made/Up" })).status).toBe(400);
    expect((await crm({ ...body, name: " " })).status).toBe(400);
    expect(await db.select().from(s.organizations)).toHaveLength(before.length);
    const response = await crm(body);
    expect(response.status).toBe(200);
    const created = await response.json();
    expect(created.organizationId).not.toBe(body.organizationId);
    const result = await read(`organizationId=${created.organizationId}`);
    const snapshot = await result.json();
    expect(snapshot.products.map((p: { id: string }) => p.id)).toEqual([
      created.productId,
    ]);
    expect(snapshot.people).toHaveLength(0);
    expect(
      snapshot.members.find((m: { id: string }) => m.id === demoUser).role,
    ).toBe("admin");
    expect(snapshot.folders).toHaveLength(1);
    expect(snapshot.stages).toHaveLength(4);
    expect(
      (await read(`organizationId=${created.organizationId}`, "demo-teammate"))
        .status,
    ).toBe(403);
    const [org] = await db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, created.organizationId));
    expect(org.timezone).toBe("Asia/Kolkata");
  });
  test("failed membership insertion rolls back the organization and all defaults", async () => {
    const before = await db.select().from(s.organizations);
    const { CrmService } = await import("../packages/core/crm");
    const service = new CrmService(db);
    await expect(
      service.createWorkspace(
        { userId: "nonexistent-test-user", source: "session" },
        { name: "Must roll back", productName: "Pilot", timezone: "UTC" },
      ),
    ).rejects.toThrow();
    expect(await db.select().from(s.organizations)).toHaveLength(before.length);
    for (const principal of [
      { userId: demoUser, source: "mcp" as const },
      { userId: demoUser, source: "session" as const, readOnly: true },
    ]) {
      await expect(
        service.createWorkspace(principal, {
          name: "Denied",
          productName: "Pilot",
          timezone: "UTC",
        }),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(await db.select().from(s.organizations)).toHaveLength(before.length);
  });
});

describe("owner-scoped Unipile webhooks", () => {
  test("a signature for one setup cannot authenticate another setup or claim its account", async () => {
    const id = demoId(991),
      otherSecret = "fictional-other-owner-secret";
    await db.insert(s.providerConfigurations).values({
      id,
      organizationId: demoId(1),
      ownerId: "demo-teammate",
      provider: "unipile",
      webhookReady: true,
      encryptedCredentials: seal(
        { apiKey: "fictional-other-key", signingSecret: otherSecret },
        `${demoId(1)}:demo-teammate:${id}:provider`,
      ),
    });
    const before = await events();
    const first = signed(linkedIn());
    expect(
      (
        await webhook(
          new Request(
            `http://localhost/api/webhooks/unipile?configurationId=${id}`,
            first,
          ),
        )
      ).status,
    ).toBe(401);
    const raw = JSON.stringify(linkedIn());
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", otherSecret)
      .update(`${timestamp}.${raw}`)
      .digest("hex");
    expect(
      (
        await webhook(
          new Request(
            `http://localhost/api/webhooks/unipile?configurationId=${id}`,
            {
              method: "POST",
              headers: {
                "unipile-signature": `t=${timestamp},v0=${signature}`,
              },
              body: raw,
            },
          ),
        )
      ).status,
    ).toBe(422);
    expect(await events()).toHaveLength(before.length);
    await db
      .update(s.providerConfigurations)
      .set({ active: false, encryptedCredentials: null })
      .where(eq(s.providerConfigurations.id, id));
    expect(
      (
        await webhook(
          new Request(
            `http://localhost/api/webhooks/unipile?configurationId=${id}`,
            {
              method: "POST",
              headers: {
                "unipile-signature": `t=${timestamp},v0=${signature}`,
              },
              body: raw,
            },
          ),
        )
      ).status,
    ).toBe(401);
  });
  test("provider-settings mutations reject cross-origin and unauthenticated requests", async () => {
    const { POST: integrations } = await import(
      "../src/app/api/integrations/route"
    );
    const body = JSON.stringify({
      operation: "configure-unipile",
      organizationId: demoId(1),
      apiKey: "fictional-user-key",
    });
    expect(
      (
        await integrations(
          new Request("http://localhost/api/integrations", {
            method: "POST",
            headers: {
              origin: "http://untrusted.test",
              "x-test-user": demoUser,
            },
            body,
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await integrations(
          new Request("http://localhost/api/integrations", {
            method: "POST",
            headers: { origin: "http://localhost" },
            body,
          }),
        )
      ).status,
    ).toBe(401);
  });
});
