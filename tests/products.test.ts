import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import {
  defaultProductColorKey,
  nearestProductColorKey,
  productColorKeys,
  productColorReferences,
  productColorToken,
} from "../packages/core/product-colors";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { mcpHandler } from "../packages/mcp/server";
import {
  operationAvailable,
  operationRequirements,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const admin: Principal = { userId: demoUser, source: "demo" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
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
  organizationId = org,
) {
  return (await find(name).execute(
    { db: local.db, principal },
    { organizationId, ...input },
  )) as T;
}
async function product(id: string) {
  const [row] = await local.db
    .select()
    .from(s.products)
    .where(eq(s.products.id, id));
  if (!row) throw new Error("product fixture");
  return row;
}
async function enrollmentsOf(productId: string) {
  return local.db
    .select()
    .from(s.enrollments)
    .where(eq(s.enrollments.productId, productId));
}

describe("product colour palette", () => {
  test("every key maps to itself and the stored seed colours map to fixed keys", () => {
    for (const key of productColorKeys)
      expect(nearestProductColorKey(productColorReferences[key])).toBe(key);
    expect(
      ["#7565cf", "#418ca0", "#ca9058", "#cf6f93"].map(nearestProductColorKey),
    ).toEqual(["violet", "teal", "orange", "pink"]);
    expect(nearestProductColorKey("#7565CF")).toBe("violet");
    expect(nearestProductColorKey("#fff")).toBe(
      nearestProductColorKey("#ffffff"),
    );
    expect(nearestProductColorKey("#808080")).toBe("gray");
    expect(nearestProductColorKey("#ff0000")).toBe("red");
    expect(nearestProductColorKey("not a colour")).toBe(defaultProductColorKey);
  });

  test("components receive a theme token, never a raw colour", () => {
    expect(productColorToken("teal")).toBe("var(--gravity-product-teal)");
    expect(productColorToken("unknown")).toBe(
      `var(--gravity-product-${defaultProductColorKey})`,
    );
  });
});

describe("update_product", () => {
  test("renames and recolours a product with a palette key", async () => {
    const updated = await run("update_product", admin, {
      productId: demoId(11),
      name: "Data Marketplace",
      colorKey: "green",
    });
    expect(updated).toMatchObject({
      id: demoId(11),
      name: "Data Marketplace",
      colorKey: "green",
    });
    expect(await product(demoId(11))).toMatchObject({
      name: "Data Marketplace",
      colorKey: "green",
    });
    const events = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.type, "product.updated"));
    expect(events).toMatchObject([{ entityId: demoId(11) }]);
  });

  test("refuses a colour outside the palette, a duplicate name and an empty change", async () => {
    await expect(
      run("update_product", admin, {
        productId: demoId(11),
        colorKey: "#ff0000",
      }),
    ).rejects.toThrow();
    await expect(
      run("update_product", admin, {
        productId: demoId(11),
        name: "AI Platform",
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_EXISTS", status: 409 });
    await expect(
      run("update_product", admin, { productId: demoId(11) }),
    ).rejects.toThrow();
    await expect(
      run("update_product", admin, {
        productId: demoId(13),
        name: "Elsewhere",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("needs an administrator with access to the product", async () => {
    await expect(
      run("update_product", teammate, {
        productId: demoId(11),
        name: "Member rename",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run(
        "update_product",
        { ...agent, productIds: [demoId(10)] },
        {
          productId: demoId(11),
          name: "Other grant",
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run(
        "update_product",
        { ...agent, productIds: [demoId(11)] },
        {
          productId: demoId(11),
          name: "Granted rename",
        },
      ),
    ).resolves.toMatchObject({ name: "Granted rename" });
    expect(operationRequirements(find("update_product"))).toMatchObject({
      administrator: true,
      allProducts: false,
    });
  });
});

describe("archiving products", () => {
  test("pauses running enrollments with a manual reason and keeps the data", async () => {
    const before = await enrollmentsOf(demoId(10));
    const running = before.filter((row) => row.status === "running");
    expect(running.length).toBeGreaterThan(0);
    const result = await run<{ pausedEnrollments: number }>(
      "archive_product",
      admin,
      { productId: demoId(10) },
    );
    expect(result).toMatchObject({
      id: demoId(10),
      pausedEnrollments: running.length,
    });
    expect((await product(demoId(10))).archivedAt).toBeInstanceOf(Date);
    const after = await enrollmentsOf(demoId(10));
    expect(after).toHaveLength(before.length);
    for (const row of running) {
      const paused = after.find((item) => item.id === row.id);
      expect(paused).toMatchObject({
        status: "paused",
        pauseReason: "manual",
        version: row.version + 1,
      });
    }
    const reply = after.find((item) => item.pauseReason === "reply");
    expect(reply?.status).toBe("paused");
    const relationships = await local.db
      .select()
      .from(s.relationships)
      .where(eq(s.relationships.productId, demoId(10)));
    expect(relationships.length).toBeGreaterThan(0);
    const pausedEvents = await local.db
      .select()
      .from(s.changeEvents)
      .where(
        and(
          eq(s.changeEvents.type, "enrollment.paused"),
          eq(s.changeEvents.productId, demoId(10)),
        ),
      );
    expect(pausedEvents).toHaveLength(running.length);
  });

  test("an archived product leaves the switcher list but its records stay readable", async () => {
    await run("archive_product", admin, { productId: demoId(10) });
    const snapshot = await new CrmService(local.db).snapshot(admin, {
      organizationId: org,
    });
    expect(snapshot.products.map((item) => item.id)).not.toContain(demoId(10));
    expect(snapshot.archivedProducts.map((item) => item.id)).toEqual([
      demoId(10),
    ]);
    expect(
      snapshot.relationships.some((item) => item.productId === demoId(10)),
    ).toBe(true);
  });

  test("new records cannot be created in an archived product", async () => {
    await run("archive_product", admin, { productId: demoId(10) });
    const refused = [
      run("create_person", admin, {
        productId: demoId(10),
        name: "Fixture Person",
      }),
      run("create_sequence", admin, {
        productId: demoId(10),
        name: "Fixture sequence",
        steps: [
          {
            number: 1,
            name: "Intro",
            delayDays: 0,
            channel: "gmail",
            template: "Hello",
            followUp: 0,
          },
        ],
      }),
      run("create_pipeline", admin, {
        productId: demoId(10),
        name: "Fixture pipeline",
      }),
      run("create_material_folder", admin, {
        productId: demoId(10),
        name: "Fixture folder",
      }),
      run("enroll_in_sequence", admin, {
        sequenceId: demoId(400),
        relationshipIds: [demoId(301)],
      }),
    ];
    for (const attempt of refused)
      await expect(attempt).rejects.toMatchObject({
        code: "PRODUCT_ARCHIVED",
        status: 409,
      });
    const [paused] = (await enrollmentsOf(demoId(10))).filter(
      (row) => row.pauseReason === "manual",
    );
    if (!paused) throw new Error("paused fixture");
    await expect(
      run("change_enrollment", admin, {
        enrollmentId: paused.id,
        version: paused.version,
        command: "resume",
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_ARCHIVED" });
  });

  test("every create path refuses an archived product while edits to existing records stay allowed", async () => {
    await run("archive_product", admin, { productId: demoId(10) });
    const relationshipId = demoId(300);
    const [action] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.relationshipId, relationshipId))
      .limit(1);
    const [existingDeal] = await local.db
      .select()
      .from(s.opportunities)
      .where(eq(s.opportunities.id, demoId(1101)));
    if (!action || !existingDeal) throw new Error("archived product fixture");
    const refused: [string, Record<string, unknown>][] = [
      [
        "schedule_next_action",
        {
          relationshipId,
          ownerId: demoUser,
          kind: "review",
          channel: "research",
          owedBy: "us",
          title: "Fixture follow-up",
          dueAt: "2026-11-01T09:00:00.000Z",
        },
      ],
      [
        "save_meeting",
        {
          relationshipId,
          title: "Fixture meeting",
          startsAt: "2026-11-01T09:00:00.000Z",
          status: "scheduled",
        },
      ],
      [
        "create_opportunity",
        { relationshipId, stageId: demoId(800), name: "Fixture deal" },
      ],
      [
        "save_deal",
        {
          productId: demoId(10),
          relationshipId,
          stageId: demoId(800),
          name: "Fixture deal",
          ownerId: demoUser,
          currency: "USD",
        },
      ],
      [
        "create_stage",
        { productId: demoId(10), pipeline: "outreach", name: "Fixture stage" },
      ],
      [
        "upload_material",
        {
          productId: demoId(10),
          folderId: demoId(900),
          name: "fixture.txt",
          mimeType: "text/plain",
          dataBase64: Buffer.from("Fixture").toString("base64"),
        },
      ],
    ];
    for (const [name, input] of refused)
      await expect(run(name, admin, input), name).rejects.toMatchObject({
        code: "PRODUCT_ARCHIVED",
        status: 409,
      });
    await local.db
      .update(s.meetings)
      .set({ status: "held", proposedCommitment: "Send the fixture recap." })
      .where(eq(s.meetings.id, demoId(1001)));
    await expect(
      run("accept_meeting_commitment", admin, {
        meetingId: demoId(1001),
        version: 1,
        ownerId: demoUser,
        dueAt: "2026-11-01T09:00:00.000Z",
      }),
      "accept_meeting_commitment",
    ).rejects.toMatchObject({ code: "PRODUCT_ARCHIVED", status: 409 });
    expect(
      await local.db
        .select()
        .from(s.actions)
        .where(eq(s.actions.title, "Send the fixture recap.")),
    ).toEqual([]);
    const session: Principal = { userId: demoUser, source: "session" };
    const [connection] = await local.db
      .insert(s.connections)
      .values({
        organizationId: org,
        productId: demoId(11),
        ownerId: demoUser,
        provider: "gmail",
        externalAccountId: "archived-link-fixture",
        status: "connected",
        selfEmail: "owner@example.test",
        encryptedCredentials: "sealed-fixture",
        scopes: [],
      })
      .returning();
    const imported = (kind: "message" | "meeting", externalId: string) => ({
      externalId,
      kind,
      title: "Archived link fixture",
      body: "Fixture body",
      occurredAt: "2026-10-01T12:00:00.000Z",
      participants: ["contact@example.test"],
      ...(kind === "message"
        ? { threadId: `${externalId}-thread`, direction: "inbound" as const }
        : {}),
    });
    const items = await local.db
      .insert(s.integrationItems)
      .values(
        (["message", "meeting"] as const).map((kind) => ({
          organizationId: org,
          productId: demoId(11),
          connectionId: connection.id,
          externalId: `archived-${kind}`,
          record: imported(kind, `archived-${kind}`),
        })),
      )
      .returning();
    for (const item of items)
      await expect(
        run("link_import", session, { itemId: item.id, relationshipId }),
        `link_import ${item.record.kind}`,
      ).rejects.toMatchObject({ code: "PRODUCT_ARCHIVED", status: 409 });
    expect(
      await local.db
        .select()
        .from(s.conversations)
        .where(eq(s.conversations.connectionId, connection.id)),
    ).toEqual([]);
    await run("plan_actions", admin, {
      items: [
        {
          actionId: action.id,
          version: action.version,
          dueAt: "2026-11-02T09:00:00.000Z",
        },
      ],
    });
    await run("change_opportunity", admin, {
      opportunityId: existingDeal.id,
      version: existingDeal.version,
      name: "Renamed fixture deal",
    });
  });

  test("the MCP product list returns active products and adds archived ones only when asked", async () => {
    await run("archive_product", admin, { productId: demoId(10) });
    const list = async (args: Record<string, unknown>) => {
      const response = await mcpHandler(local.db, agent, org).fetch(
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
            params: { name: "list_products", arguments: args },
          }),
        }),
      );
      const body = await response.text();
      const envelope = JSON.parse(
        body
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6) ?? body,
      );
      return JSON.parse(envelope.result.content[0].text) as {
        id: string;
        colorKey: string;
        archivedAt: string | null;
      }[];
    };
    const active = await list({});
    expect(Array.isArray(active)).toBe(true);
    expect(active.map((item) => item.id).sort()).toEqual(
      [demoId(11), demoId(12)].sort(),
    );
    const all = await list({ includeArchived: true });
    expect(all.map((item) => item.id).sort()).toEqual(
      [demoId(10), demoId(11), demoId(12)].sort(),
    );
    expect(all.find((item) => item.id === demoId(10))?.archivedAt).toEqual(
      expect.any(String),
    );
    expect(all.find((item) => item.id === demoId(11))?.archivedAt).toBeNull();
    for (const item of [...active, ...all]) {
      expect(item).not.toHaveProperty("color");
      expect(productColorKeys).toContain(item.colorKey);
    }
  });

  test("no product result carries the legacy colour hex", async () => {
    const results = [
      await run("update_product", admin, {
        productId: demoId(11),
        colorKey: "teal",
      }),
      await run("archive_product", admin, { productId: demoId(10) }),
      await run("restore_product", admin, { productId: demoId(10) }),
      await run("create_product", admin, { name: "Fixture product" }),
    ];
    const snapshot = await new CrmService(local.db).snapshot(admin, {
      organizationId: org,
    });
    for (const item of [
      ...results,
      ...snapshot.products,
      ...snapshot.archivedProducts,
    ]) {
      expect(item).not.toHaveProperty("color");
      expect(item).toHaveProperty("colorKey");
    }
  });

  test("read-only assistants cannot change products", async () => {
    const reader: Principal = { ...agent, readOnly: true };
    for (const [name, input] of [
      ["update_product", { productId: demoId(11), name: "Read-only rename" }],
      ["archive_product", { productId: demoId(11) }],
      ["restore_product", { productId: demoId(11) }],
    ] as const)
      await expect(run(name, reader, input), name).rejects.toMatchObject({
        status: 403,
      });
    expect((await product(demoId(11))).name).toBe("API Marketplace");
  });

  test("the last active product cannot be archived", async () => {
    await expect(
      run("archive_product", admin, { productId: demoId(13) }, demoId(2)),
    ).rejects.toMatchObject({ code: "LAST_ACTIVE_PRODUCT", status: 409 });
    await run("archive_product", admin, { productId: demoId(10) });
    await run("archive_product", admin, { productId: demoId(11) });
    await expect(
      run("archive_product", admin, { productId: demoId(12) }),
    ).rejects.toMatchObject({ code: "LAST_ACTIVE_PRODUCT" });
    expect((await product(demoId(12))).archivedAt).toBeNull();
  });

  test("archiving twice and restoring an active product are refused", async () => {
    await run("archive_product", admin, { productId: demoId(11) });
    await expect(
      run("archive_product", admin, { productId: demoId(11) }),
    ).rejects.toMatchObject({ code: "PRODUCT_ARCHIVED" });
    await expect(
      run("restore_product", admin, { productId: demoId(12) }),
    ).rejects.toMatchObject({ code: "PRODUCT_ACTIVE" });
  });

  test("restoring brings the product back without resuming paused work", async () => {
    await run("archive_product", admin, { productId: demoId(10) });
    const restored = await run("restore_product", admin, {
      productId: demoId(10),
    });
    expect(restored).toMatchObject({ id: demoId(10), archivedAt: null });
    const snapshot = await new CrmService(local.db).snapshot(admin, {
      organizationId: org,
    });
    expect(snapshot.products.map((item) => item.id)).toContain(demoId(10));
    expect(snapshot.archivedProducts).toEqual([]);
    expect(
      (await enrollmentsOf(demoId(10))).filter(
        (row) => row.status === "running",
      ),
    ).toEqual([]);
    await expect(
      run("create_material_folder", admin, {
        productId: demoId(10),
        name: "Back in business",
      }),
    ).resolves.toBeTruthy();
  });

  test("archive and restore need an administrator with an all-products grant", async () => {
    for (const name of ["archive_product", "restore_product"]) {
      for (const principal of [
        teammate,
        { ...agent, productIds: [demoId(11)] },
      ])
        await expect(
          run(name, principal, { productId: demoId(11) }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(operationRequirements(find(name))).toMatchObject({
        administrator: true,
        allProducts: true,
      });
      expect(
        operationAvailable(
          find(name),
          { ...agent, productIds: [demoId(11)] },
          "admin",
        ),
      ).toBe(false);
    }
  });
});

test("new products cycle through the palette instead of all starting violet", async () => {
  const crm = new CrmService(local.db);
  const existing = await local.db
    .select({ id: s.products.id })
    .from(s.products)
    .where(eq(s.products.organizationId, org));
  const keys: string[] = [];
  for (const index of productColorKeys.keys()) {
    const created = await crm.createProduct(admin, org, `Palette ${index}`);
    keys.push((await product(created.id)).colorKey);
  }
  expect(keys).toEqual(
    productColorKeys.map(
      (_, index) =>
        productColorKeys[(existing.length + index) % productColorKeys.length],
    ),
  );
  expect(new Set(keys).size).toBe(productColorKeys.length);
});
