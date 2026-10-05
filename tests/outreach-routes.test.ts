import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import { DomainError } from "../packages/core/policy";
import type { Database } from "../packages/database/client";
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
});
