import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import { DomainError } from "../packages/core/policy";
import type { Database } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let db: Database;
vi.mock("@crm/database/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDatabase: async () => db,
  isDemoMode: () => false,
}));
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

import { POST as crmPost } from "../src/app/api/crm/route";
import { GET, POST } from "../src/app/api/outreach/route";

let local: Awaited<
  ReturnType<
    typeof import("../packages/database/client")["createLocalDatabase"]
  >
>;
const org = demoId(1);
beforeAll(async () => {
  const module = await vi.importActual<
    typeof import("../packages/database/client")
  >("../packages/database/client");
  local = await module.createLocalDatabase();
  db = local.db;
  await seedDemo(db);
});
afterAll(async () => {
  await local.client.close();
});

function post(body: object, user = demoUser, origin = "http://localhost") {
  return POST(
    new Request("http://localhost/api/outreach", {
      method: "POST",
      headers: { "x-test-user": user, origin },
      body: JSON.stringify(body),
    }),
  );
}
function get(query: Record<string, string>, user?: string) {
  return GET(
    new Request(
      `http://localhost/api/outreach?${new URLSearchParams(query).toString()}`,
      { headers: user ? { "x-test-user": user } : {} },
    ),
  );
}

describe("outreach HTTP contracts", () => {
  test("enroll, list due, report sent once, and refuse what the caller may not do", async () => {
    const rules = await (
      await get({ operation: "rules", organizationId: org }, demoUser)
    ).json();
    expect(
      (
        await post({
          operation: "rules",
          organizationId: org,
          version: rules.version,
          cooldownDays: 3,
          dailyCapPerSender: 40,
          quietHoursStart: 0,
          quietHoursEnd: 0,
        })
      ).status,
    ).toBe(200);
    const person = await new CrmService(db).createPerson(
      { userId: demoUser, source: "demo" },
      {
        organizationId: org,
        productId: demoId(10),
        name: "Route fixture",
        email: "route-fixture@example.test",
        title: "",
        purpose: "buyer",
        context: "",
        review: false,
        channel: "gmail",
      },
    );
    const enrollBody = {
      operation: "enroll",
      organizationId: org,
      sequenceId: demoId(400),
      relationshipIds: [person.relationshipId],
    };
    expect((await post(enrollBody, demoUser, "http://evil.test")).status).toBe(
      403,
    );
    expect((await post({ ...enrollBody, sequenceId: "nope" })).status).toBe(
      400,
    );
    const enrolled = await post(enrollBody);
    expect(enrolled.status).toBe(200);
    expect((await enrolled.json()).enrolled).toHaveLength(1);
    expect((await get({ organizationId: org })).status).toBe(401);
    const due = await (
      await get({ organizationId: org, productId: demoId(10) }, demoUser)
    ).json();
    const touch = due.groups[0].touches.find(
      (row: { relationshipId: string }) =>
        row.relationshipId === person.relationshipId,
    );
    expect(touch).toMatchObject({ status: "planned", stepNumber: 1 });
    expect(
      (
        await get(
          { operation: "touch", organizationId: org, touchId: touch.id },
          "demo-restricted",
        )
      ).status,
    ).toBe(403);
    const sent = await post({
      operation: "sent",
      organizationId: org,
      touchId: touch.id,
      externalMessageId: "route-message",
    });
    expect(sent.status).toBe(200);
    expect((await sent.json()).touch.status).toBe("sent");
    const again = await post({
      operation: "sent",
      organizationId: org,
      touchId: touch.id,
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      error: "TOUCH_ALREADY_SENT",
      details: { sentBy: "Alex Morgan", externalMessageId: "route-message" },
    });
  });
  test("listing due touches is read-only and only a same-origin POST advances enrollments", async () => {
    const crm = new CrmService(db);
    const product = await crm.createProduct(
      { userId: demoUser, source: "demo" },
      org,
      "Route advance fixture",
    );
    const person = await crm.createPerson(
      { userId: demoUser, source: "demo" },
      {
        organizationId: org,
        productId: product.id,
        name: "Route advance person",
        email: "route-advance@example.test",
        title: "",
        purpose: "buyer",
        context: "",
        review: false,
        channel: "gmail",
      },
    );
    const [sequence] = await db
      .insert(s.sequences)
      .values({
        organizationId: org,
        productId: product.id,
        name: "Route advance sequence",
        steps: [
          {
            number: 1,
            name: "Introduction",
            delayDays: 0,
            channel: "gmail",
            template: "Fictional template",
            followUp: 0,
          },
        ],
      })
      .returning();
    await db.insert(s.enrollments).values({
      organizationId: org,
      productId: product.id,
      relationshipId: person.relationshipId,
      sequenceId: sequence?.id ?? "",
      status: "running",
      enrolledAt: new Date(),
    });
    const planned = () =>
      db
        .select()
        .from(s.touches)
        .where(eq(s.touches.relationshipId, person.relationshipId));
    const due = await get({ operation: "due", organizationId: org }, demoUser);
    expect(due.status).toBe(200);
    expect(await due.json()).not.toHaveProperty("advanced");
    expect(await planned()).toEqual([]);
    expect(
      (
        await post(
          { operation: "advance", organizationId: org },
          demoUser,
          "https://elsewhere.example",
        )
      ).status,
    ).toBe(403);
    expect(await planned()).toEqual([]);
    const advanced = await post({ operation: "advance", organizationId: org });
    expect(advanced.status).toBe(200);
    expect((await advanced.json()).created).toBeGreaterThanOrEqual(1);
    expect(await planned()).toHaveLength(1);
  });
  test("the queue lists recent sends and a skipped touch reopens through the route", async () => {
    const queue = await (
      await get(
        { operation: "queue", organizationId: org, productId: demoId(10) },
        demoUser,
      )
    ).json();
    expect(
      queue.sent.map(
        (row: { externalMessageId: string }) => row.externalMessageId,
      ),
    ).toContain("route-message");
    const draft = queue.drafts.find(
      (row: { status: string }) => row.status === "planned",
    );
    expect(draft).toBeTruthy();
    const skipped = await (
      await post({
        operation: "skip",
        organizationId: org,
        touchId: draft.id,
        version: draft.version,
        reason: "Route skip",
      })
    ).json();
    const reopened = await post({
      operation: "reopen",
      organizationId: org,
      touchId: draft.id,
      version: skipped.version,
    });
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).status).toBe("drafted");
  });
});

test("HTTP relationship context accepts the same typed fields and checks origin, product and version", async () => {
  const [record] = await db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, demoId(300)));
  const body = {
    operation: "relationship",
    organizationId: org,
    productId: demoId(10),
    relationshipId: record.id,
    version: record.version,
    context: "Readable route context",
    contextDetails: {
      timing: "Next quarter",
      fields: [
        {
          id: demoId(8910),
          label: "Public site",
          type: "url",
          value: "https://example.test",
        },
      ],
    },
  };
  expect((await post(body, demoUser, "http://evil.test")).status).toBe(403);
  expect((await post({ ...body, productId: demoId(11) })).status).toBe(403);
  const saved = await post(body);
  expect(saved.status).toBe(200);
  expect((await saved.json()).contextDetails.timing).toBe("Next quarter");
  expect((await post(body)).status).toBe(409);
  expect(
    (
      await post({
        ...body,
        version: record.version + 1,
        contextDetails: {
          fields: [
            {
              id: demoId(8910),
              label: "Site",
              type: "url",
              value: "javascript:alert(1)",
            },
          ],
        },
      })
    ).status,
  ).toBe(400);
});

test("HTTP creation supports structured context above the old 50 KB adapter limit", async () => {
  const fields = Array.from({ length: 6 }, (_, index) => ({
    id: demoId(9400 + index),
    label: `Fictional field ${index}`,
    type: "text",
    value: "x".repeat(9000),
  }));
  const body = JSON.stringify({
    operation: "person",
    organizationId: org,
    productId: demoId(10),
    name: "Large fictional context fixture",
    context: "Readable summary",
    contextDetails: { fields },
    review: false,
  });
  expect(new TextEncoder().encode(body).length).toBeGreaterThan(50000);
  const response = await crmPost(
    new Request("http://localhost/api/crm", {
      method: "POST",
      headers: { "x-test-user": demoUser, origin: "http://localhost" },
      body,
    }),
  );
  expect(response.status).toBe(200);
  const record = await response.json();
  const context = await new CrmService(db).context(
    { userId: demoUser, source: "session" },
    org,
    record.relationshipId,
  );
  expect(context.relationship.contextDetails.fields).toHaveLength(6);
});
