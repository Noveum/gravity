import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CrmService } from "../packages/core/crm";
import {
  OutreachService,
  relationshipChangeSchema,
} from "../packages/core/outreach";
import type { Principal } from "../packages/core/policy";
import {
  importedContext,
  relationshipDetailsPatchSchema,
  relationshipFieldSchema,
} from "../packages/core/relationship-context";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let outreach: OutreachService;
let crm: CrmService;
const org = demoId(1);
const principal: Principal = { userId: demoUser, source: "session" };
const scope = {
  organizationId: org,
  productId: demoId(10),
  relationshipId: demoId(300),
};
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  outreach = new OutreachService(local.db);
  crm = new CrmService(local.db);
});
afterAll(async () => {
  await local.client.close();
});
async function row() {
  const [record] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, scope.relationshipId));
  return record;
}
const signal = {
  id: demoId(8000),
  title: "Hiring infrastructure engineers",
  description: "Public careers listing; potential need is unconfirmed.",
  kind: "hiring" as const,
  classification: "fact" as const,
  sourceUrl: "https://example.test/careers",
  observedAt: "2026-10-06T08:00:00Z",
};

describe("relationship context", () => {
  test("versioned structured edits persist, preserve omitted sections, original imports and all operational state", async () => {
    const legacy = JSON.stringify({
      relationship: "A fictional evaluation",
      effective_send_permission: true,
      latest_outbound: { body: "Imported claim, not a real sent message" },
    });
    await local.db
      .update(s.relationships)
      .set({ context: legacy })
      .where(eq(s.relationships.id, scope.relationshipId));
    const before = await row();
    const operational = await Promise.all([
      local.db.select().from(s.actions),
      local.db.select().from(s.messages),
      local.db.select().from(s.enrollments),
      local.db.select().from(s.touches),
      local.db.select().from(s.deliveries),
    ]);
    const changed = await outreach.changeRelationship(principal, {
      ...scope,
      version: before.version,
      context: "Review the evaluation requirements.",
      contextDetails: {
        needs: "Reliable exports",
        history: "Met at a fictional event.",
        signals: [signal],
        fields: [
          { id: demoId(8001), label: "Team size", type: "number", value: 12 },
          {
            id: demoId(8002),
            label: "Budget verified",
            type: "boolean",
            value: false,
          },
        ],
      },
    });
    expect(changed.contextSource).toBe(legacy);
    expect(changed.contextDetails.signals).toEqual([signal]);
    expect(changed.contextDetails.fields[1]?.value).toBe(false);
    expect(changed.version).toBe(before.version + 1);
    const read = await crm.context(principal, org, scope.relationshipId);
    const workspace = await crm.snapshot(principal, { organizationId: org });
    const summary = workspace.relationships.find(
      (item) => item.id === scope.relationshipId,
    );
    expect(summary).not.toHaveProperty("contextDetails");
    expect(summary).not.toHaveProperty("contextSource");
    expect(read.relationship.contextDetails.history).toBe(
      "Met at a fictional event.",
    );
    const partial = await outreach.changeRelationship(principal, {
      ...scope,
      version: changed.version,
      contextDetails: { budget: "Not verified" },
    });
    expect(partial.contextDetails.needs).toBe("Reliable exports");
    expect(partial.contextDetails.signals).toEqual([signal]);
    const cleared = await outreach.changeRelationship(principal, {
      ...scope,
      version: partial.version,
      context: "",
      contextDetails: { signals: [], fields: [], needs: "" },
    });
    expect(cleared.context).toBe("");
    expect(cleared.contextSource).toBe(legacy);
    expect(cleared.contextDetails.signals).toEqual([]);
    expect(cleared.contextDetails.budget).toBe("Not verified");
    expect(
      await Promise.all([
        local.db.select().from(s.actions),
        local.db.select().from(s.messages),
        local.db.select().from(s.enrollments),
        local.db.select().from(s.touches),
        local.db.select().from(s.deliveries),
      ]),
    ).toEqual(operational);
    expect(cleared.nextStep).toBe(before.nextStep);
    expect(cleared.qualification).toBe(before.qualification);
  });
  test("stale, read-only, cross-product, cross-organization, archived and revoked-member edits are rejected", async () => {
    const current = await row();
    const args = {
      ...scope,
      version: current.version,
      contextDetails: { needs: "Forbidden edit" },
    };
    await expect(
      outreach.changeRelationship(principal, {
        ...args,
        version: current.version - 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    for (const p of [
      { ...principal, source: "mcp" as const, readOnly: true },
      {
        ...principal,
        source: "mcp" as const,
        organizationId: demoId(2),
        readOnly: false,
      },
      {
        ...principal,
        source: "mcp" as const,
        productIds: [demoId(11)],
        readOnly: false,
      },
      { ...principal, userId: "demo-restricted" },
    ]) {
      await expect(outreach.changeRelationship(p, args)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    await expect(
      outreach.changeRelationship(principal, {
        ...args,
        organizationId: demoId(2),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outreach.changeRelationship(principal, {
        ...args,
        productId: demoId(11),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await local.db
      .update(s.people)
      .set({ archivedAt: new Date() })
      .where(eq(s.people.id, current.personId));
    await expect(
      outreach.changeRelationship(principal, args),
    ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    await local.db
      .update(s.people)
      .set({ archivedAt: null })
      .where(eq(s.people.id, current.personId));
    await local.db
      .update(s.memberships)
      .set({ active: false })
      .where(eq(s.memberships.userId, demoUser));
    await expect(
      outreach.changeRelationship(principal, args),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await local.db
      .update(s.memberships)
      .set({ active: true })
      .where(eq(s.memberships.userId, demoUser));
    expect((await row()).contextDetails).toEqual(current.contextDetails);
  });
  test("new relationships accept typed context without a later edit", async () => {
    const created = await crm.createPerson(principal, {
      organizationId: org,
      productId: demoId(10),
      name: "Fictional structured contact",
      title: "",
      purpose: "buyer",
      context: "A readable summary",
      contextDetails: {
        background: "Public profile reviewed",
        signals: [signal],
      },
      review: false,
      channel: "gmail",
    });
    expect(
      (await crm.context(principal, org, created.relationshipId)).relationship
        .contextDetails.signals,
    ).toEqual([signal]);
  });
});
test("context schemas reject unknown fields, duplicate IDs, invalid dates, unsafe URLs, incorrect value types and oversized context", () => {
  expect(
    relationshipChangeSchema.safeParse({ ...scope, version: 1, context: "" })
      .success,
  ).toBe(true);
  expect(
    relationshipChangeSchema.safeParse({
      ...scope,
      version: 1,
      contextDetails: {},
    }).success,
  ).toBe(false);
  expect(
    relationshipDetailsPatchSchema.safeParse({ sendingAllowed: true }).success,
  ).toBe(false);
  expect(
    relationshipDetailsPatchSchema.safeParse({ signals: [signal, signal] })
      .success,
  ).toBe(false);
  for (const sourceUrl of [
    "javascript:alert(1)",
    "data:text/html,x",
    "https://user:password@example.test",
  ])
    expect(
      relationshipDetailsPatchSchema.safeParse({
        signals: [{ ...signal, sourceUrl }],
      }).success,
    ).toBe(false);
  expect(
    relationshipDetailsPatchSchema.safeParse({
      signals: [{ ...signal, observedAt: "2026-02-31T00:00:00Z" }],
    }).success,
  ).toBe(false);
  expect(
    relationshipFieldSchema.safeParse({
      id: demoId(8001),
      label: "Budget",
      type: "number",
      value: "12",
    }).success,
  ).toBe(false);
  expect(
    relationshipFieldSchema.safeParse({
      id: demoId(8001),
      label: "Date",
      type: "date",
      value: "2026-02-31",
    }).success,
  ).toBe(false);
  expect(
    relationshipDetailsPatchSchema.safeParse({
      signals: Array.from({ length: 9 }, (_, i) => ({
        ...signal,
        id: demoId(8100 + i),
        description: "x".repeat(10000),
      })),
    }).success,
  ).toBe(false);
  expect(importedContext("Ordinary notes")).toBeNull();
  expect(importedContext("123")).toBeNull();
  expect(importedContext("{broken")).toBeNull();
  expect(
    importedContext(JSON.stringify({ long: "x".repeat(200001) })),
  ).toBeNull();
});

test("combined context payload is bounded consistently before either transport writes", () => {
  const fields = Array.from({ length: 7 }, (_, index) => ({
    id: demoId(9300 + index),
    label: `Field ${index}`,
    type: "text",
    value: "x".repeat(10000),
  }));
  expect(relationshipDetailsPatchSchema.safeParse({ fields }).success).toBe(
    true,
  );
  expect(
    relationshipChangeSchema.safeParse({
      ...scope,
      version: 1,
      context: "💫".repeat(5000),
      contextDetails: { fields },
    }).success,
  ).toBe(false);
});
