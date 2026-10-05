import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { publishChange } from "../packages/core/changes";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import type { Database } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let db: Database;
// Authentication is injected; all access/revision queries exercise the real SQL schema.
vi.mock("@crm/database/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDatabase: async () => db,
}));
vi.mock("@crm/auth/server", () => ({
  currentPrincipal: async (headers: Headers): Promise<Principal> => ({
    userId: headers.get("x-test-user") || "demo-you",
    source: "session",
  }),
}));

import { GET } from "../src/app/api/crm/live/route";

let local: Awaited<
  ReturnType<
    typeof import("../packages/database/client")["createLocalDatabase"]
  >
>;
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
async function revisionEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let text = "";
  while (true) {
    const next = await reader.read();
    if (next.done) return text;
    text += new TextDecoder().decode(next.value);
    if (
      text.includes("event: revision") ||
      text.includes("event: access-changed")
    )
      return text;
  }
}
describe("authorized live delivery", () => {
  test("a private-source update emits a revision only to its owner", async () => {
    const service = new CrmService(db);
    const ownerBefore = await service.revision(
      { userId: demoUser, source: "session" },
      demoId(1),
    );
    const otherBefore = await service.revision(
      { userId: "demo-teammate", source: "session" },
      demoId(1),
    );
    const abort = new AbortController();
    const response = await GET(
      new Request(`http://localhost/api/crm/live?organizationId=${demoId(1)}`, {
        headers: { "x-test-user": demoUser },
        signal: abort.signal,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) throw Error("Missing stream");
    try {
      expect(await revisionEvent(reader)).toContain(ownerBefore);
      await db.insert(s.changeEvents).values({
        organizationId: demoId(1),
        productId: demoId(12),
        sourceConversationId: demoId(711),
        actorId: demoUser,
        type: "private.fixture",
        entityId: demoId(711),
      });
      publishChange(demoId(1));
      const event = await revisionEvent(reader);
      expect(event).toContain(
        `"revision":"${await service.revision({ userId: demoUser, source: "session" }, demoId(1))}"`,
      );
      expect(event).not.toContain("private.fixture");
      expect(event).not.toContain(demoId(711));
      expect(
        await service.revision(
          { userId: "demo-teammate", source: "session" },
          demoId(1),
        ),
      ).toBe(otherBefore);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });
  test("membership revocation closes an existing stream and rejects a new one", async () => {
    const abort = new AbortController();
    const request = () =>
      new Request(`http://localhost/api/crm/live?organizationId=${demoId(1)}`, {
        headers: { "x-test-user": "demo-teammate" },
        signal: abort.signal,
      });
    const response = await GET(request());
    const reader = response.body?.getReader();
    if (!reader) throw Error("Missing stream");
    try {
      await revisionEvent(reader);
      await db
        .update(s.memberships)
        .set({ active: false })
        .where(
          and(
            eq(s.memberships.organizationId, demoId(1)),
            eq(s.memberships.userId, "demo-teammate"),
          ),
        );
      publishChange(demoId(1));
      expect(await revisionEvent(reader)).toContain("event: access-changed");
      expect((await reader.read()).done).toBe(true);
      expect((await GET(request())).status).toBe(403);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });
});
