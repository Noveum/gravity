import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ContactAttributionService } from "../packages/core/contact-attribution";
import { CrmService } from "../packages/core/crm";
import { RecordService } from "../packages/core/records";
import {
  emptyRelationshipDetails,
  relationshipDetailsSchema,
} from "../packages/core/relationship-context";
import type { Database } from "../packages/database/client";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { apiOperation } from "../packages/operations/catalog";

let local: { db: Database; client: { close(): Promise<void> } };
const serverUrl = process.env.GRAVITY_POSTGRES_TEST_URL ?? "";
let pg: postgres.Sql | undefined;
const org = demoId(1),
  product = demoId(10),
  admin = { userId: demoUser, source: "session" as const };
beforeAll(async () => {
  if (serverUrl) {
    const url = new URL(serverUrl);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error("LOCAL_DATABASE_REQUIRED");
    const server = postgres(serverUrl, { max: 1, onnotice: () => {} });
    const name = `gravity_merge_${randomUUID().replaceAll("-", "")}`;
    await server.unsafe(`CREATE DATABASE ${name}`);
    url.pathname = `/${name}`;
    pg = postgres(url.toString(), { max: 4, onnotice: () => {} });
    const db = drizzle(pg, { schema: s });
    local = {
      db,
      client: {
        close: async () => {
          await pg?.end();
          await server.unsafe(`DROP DATABASE ${name}`);
          await server.end();
        },
      },
    };
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  } else local = await createLocalDatabase();
  await seedDemo(local.db);
}, 120000);
afterAll(async () => {
  await local?.client.close();
});
async function pair(extra: Record<string, unknown> = {}) {
  const crm = new CrmService(local.db);
  const create = (name: string) =>
    crm.createPerson(admin, {
      organizationId: org,
      productId: product,
      name,
      email: `${randomUUID()}@example.test`,
      title: "",
      purpose: "buyer",
      context: "",
      review: false,
      channel: "gmail",
    });
  const a = await create("Review Target"),
    b = await create("Review Source");
  const [target] = await local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, a.personId));
  const [source] = await local.db
    .update(s.people)
    .set({ title: "", ...extra })
    .where(eq(s.people.id, b.personId))
    .returning();
  const [tr] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, a.relationshipId));
  const [sr] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, b.relationshipId));
  return {
    target,
    source,
    tr,
    sr,
    input: {
      organizationId: org,
      entity: "person" as const,
      targetId: target.id,
      sourceId: source.id,
      targetVersion: target.version,
      sourceVersion: source.version,
    },
  };
}
test("transfers a source LinkedIn identity safely", async () => {
  const p = await pair({
    linkedinUrl: "https://www.linkedin.com/in/fictional-review-source",
  });
  const operation = apiOperation("crm", "POST", "merge-records");
  await expect(
    operation.execute(
      { db: local.db, principal: admin },
      operation.schema.parse(p.input),
    ),
  ).resolves.toMatchObject({
    id: p.target.id,
    linkedinUrl: p.source.linkedinUrl,
  });
});
test("retains unknown delivery claims while moving history", async () => {
  const p = await pair();
  const [action] = await local.db
    .insert(s.actions)
    .values({
      organizationId: org,
      productId: product,
      relationshipId: p.sr.id,
      ownerId: demoUser,
      kind: "reply",
      title: "Fictional action",
      reason: "Review",
      owedBy: "us",
      channel: "gmail",
      dueAt: new Date(),
    })
    .returning();
  const [delivery] = await local.db
    .insert(s.deliveries)
    .values({
      organizationId: org,
      productId: product,
      relationshipId: p.sr.id,
      ownerId: demoUser,
      connectionId: demoId(700),
      actionId: action.id,
      sourceVersion: 1,
      idempotencyKey: randomUUID(),
      requestHash: "review",
      channel: "gmail",
      recipient: "fictional-review@example.test",
      draft: "Fictional body",
      status: "unknown",
    })
    .returning();
  await new RecordService(local.db).mergeRecords(admin, p.input);
  const [after] = await local.db
    .select()
    .from(s.deliveries)
    .where(eq(s.deliveries.id, delivery.id));
  expect(after).toEqual({ ...delivery, relationshipId: p.tr.id });
});
test("retains source relationship context and activity", async () => {
  const p = await pair();
  await local.db
    .update(s.relationships)
    .set({
      context: "Fictional context that must survive",
      nextStep: "Fictional next step",
      touchCount: 7,
    })
    .where(eq(s.relationships.id, p.sr.id));
  await new RecordService(local.db).mergeRecords(admin, p.input);
  const [target] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, p.tr.id));
  expect(target.context).toBe("Fictional context that must survive");
  expect(target.nextStep).toBe("Fictional next step");
  expect(target.touchCount).toBe(7);
});
test("moves enrollments and touches without breaking immediate constraints", async () => {
  const p = await pair();
  const [sequence] = await local.db
    .insert(s.sequences)
    .values({
      organizationId: org,
      productId: product,
      name: "Fictional Review Sequence",
      steps: [],
    })
    .returning();
  const [enrollment] = await local.db
    .insert(s.enrollments)
    .values({
      organizationId: org,
      productId: product,
      relationshipId: p.sr.id,
      sequenceId: sequence.id,
      status: "running",
    })
    .returning();
  await local.db.insert(s.touches).values({
    organizationId: org,
    productId: product,
    relationshipId: p.sr.id,
    enrollmentId: enrollment.id,
    stepNumber: 1,
    followUp: 0,
    channel: "gmail",
    senderId: demoUser,
    dueAt: new Date(),
  });
  await new RecordService(local.db).mergeRecords(admin, p.input);
  const [after] = await local.db
    .select()
    .from(s.touches)
    .where(eq(s.touches.enrollmentId, enrollment.id));
  expect(after.relationshipId).toBe(p.tr.id);
});
test("preserves both original creators for normally created contacts", async () => {
  const p = await pair();
  await new RecordService(local.db).mergeRecords(admin, p.input);
  const history = await local.db
    .select()
    .from(s.contactContributions)
    .where(eq(s.contactContributions.personId, p.target.id));
  expect(history.filter((h) => h.kind === "created")).toHaveLength(2);
});
test("denies company merges affecting hidden products", async () => {
  const [target, source] = await local.db
    .insert(s.companies)
    .values([
      { organizationId: org, name: "Visible Target" },
      { organizationId: org, name: "Shared Source" },
    ])
    .returning();
  const [visibleTarget, visibleSource, hidden] = await local.db
    .insert(s.people)
    .values([
      { organizationId: org, name: "Visible T", companyId: target.id },
      { organizationId: org, name: "Visible S", companyId: source.id },
      { organizationId: org, name: "Hidden employee", companyId: source.id },
    ])
    .returning();
  await local.db.insert(s.relationships).values(
    [visibleTarget, visibleSource, hidden].map((p) => ({
      organizationId: org,
      productId: p.id === hidden.id ? demoId(10) : demoId(11),
      personId: p.id,
      ownerId: demoUser,
    })),
  );
  await expect(
    new RecordService(local.db).mergeRecords(
      {
        userId: "demo-restricted",
        source: "session",
        productIds: [demoId(11)],
      },
      {
        organizationId: org,
        entity: "company",
        targetId: target.id,
        sourceId: source.id,
        targetVersion: target.version,
        sourceVersion: source.version,
      },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const [after] = await local.db
    .select()
    .from(s.people)
    .where(eq(s.people.id, hidden.id));
  expect(after.companyId).toBe(source.id);
  expect(after.version).toBe(1);
});

test.each(["source", "target"])(
  "denies person merges affecting an inaccessible %s product including archives",
  async (side) => {
    const p = await pair();
    const crm = new CrmService(local.db);
    const hidden = await crm.createProduct(
      admin,
      org,
      `Hidden ${randomUUID()}`,
    );
    await local.db.insert(s.relationships).values({
      organizationId: org,
      productId: hidden.id,
      personId: side === "source" ? p.source.id : p.target.id,
      ownerId: demoUser,
    });
    await local.db
      .update(s.products)
      .set({ archivedAt: new Date() })
      .where(eq(s.products.id, hidden.id));
    await expect(
      new RecordService(local.db).mergeRecords(
        { ...admin, source: "mcp", readOnly: false, productIds: [product] },
        p.input,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await local.db
        .select()
        .from(s.people)
        .where(eq(s.people.id, p.source.id)),
    ).toHaveLength(1);
  },
);

test("retains conflicting structured context, metadata and provenance in accessible product history", async () => {
  const p = await pair();
  const id = randomUUID();
  const details = {
    ...emptyRelationshipDetails(),
    background: "Original background",
    fields: [
      {
        id,
        label: "Original label",
        type: "text" as const,
        value: "Original value",
      },
    ],
  };
  await local.db
    .update(s.relationships)
    .set({
      context: "Canonical context",
      priority: "normal",
      contextDetails: {
        ...emptyRelationshipDetails(),
        background: "Canonical background",
        fields: [
          { id, label: "Current label", type: "text", value: "Current value" },
        ],
      },
    })
    .where(eq(s.relationships.id, p.tr.id));
  const [original] = await local.db
    .update(s.relationships)
    .set({
      context: "Original context",
      contextDetails: details,
      priority: "high",
      nextStep: "Call",
      touchCount: 7,
      tags: ["original"],
      amountMinor: 500,
      currency: "EUR",
    })
    .where(eq(s.relationships.id, p.sr.id))
    .returning();
  await new RecordService(local.db).mergeRecords(admin, p.input);
  const context = await new CrmService(local.db).context(admin, org, p.tr.id);
  expect(context.relationship.context).toBe("Canonical context");
  expect(context.relationship.contextDetails.background).toBe(
    "Canonical background",
  );
  const { mergeHistory: _history, ...snapshot } = JSON.parse(
    JSON.stringify(original),
  );
  expect(context.relationship.mergeHistory).toEqual([
    expect.objectContaining(snapshot),
  ]);
  const attribution = await new ContactAttributionService(local.db).list(
    admin,
    { organizationId: org, personId: p.target.id, limit: 30, offset: 0 },
  );
  expect(attribution.creator?.mergedFromPersonId).toBeNull();
  expect(attribution.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "created",
        mergedFromPersonId: p.source.id,
      }),
    ]),
  );
});

test.each(["running", "paused"] as const)(
  "stops a duplicate %s enrollment and preserves all touch and delivery history",
  async (status) => {
    const p = await pair();
    const [sequence] = await local.db
      .insert(s.sequences)
      .values({
        organizationId: org,
        productId: product,
        name: "Fictional duplicate sequence",
        steps: [],
      })
      .returning();
    const [targetEnrollment, sourceEnrollment] = await local.db
      .insert(s.enrollments)
      .values(
        [p.tr, p.sr].map((rel) => ({
          organizationId: org,
          productId: product,
          relationshipId: rel.id,
          sequenceId: sequence.id,
          status,
          pauseReason: status === "paused" ? ("manual" as const) : null,
        })),
      )
      .returning();
    const [touch] = await local.db
      .insert(s.touches)
      .values({
        organizationId: org,
        productId: product,
        relationshipId: p.sr.id,
        enrollmentId: sourceEnrollment.id,
        stepNumber: 1,
        followUp: 0,
        channel: "gmail",
        senderId: demoUser,
        dueAt: new Date(),
        status: "approved",
        draft: "Fictional",
        draftHash: "hash",
        approvedHash: "hash",
        approvedBy: demoUser,
      })
      .returning();
    await new RecordService(local.db).mergeRecords(admin, p.input);
    const [moved] = await local.db
      .select()
      .from(s.touches)
      .where(eq(s.touches.id, touch.id));
    expect(moved).toMatchObject({
      relationshipId: p.tr.id,
      enrollmentId: sourceEnrollment.id,
      status: "skipped",
      approvedHash: null,
      version: touch.version + 1,
    });
    const [stopped] = await local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.id, sourceEnrollment.id));
    expect(stopped).toMatchObject({
      relationshipId: p.tr.id,
      status: "stopped",
      pauseReason: null,
      version: sourceEnrollment.version + 1,
    });
    const [untouched] = await local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.id, targetEnrollment.id));
    expect(untouched).toEqual(targetEnrollment);
  },
);

test("invalidates source approval even when the canonical person's fields do not change", async () => {
  const p = await pair();
  const [action] = await local.db
    .insert(s.actions)
    .values({
      organizationId: org,
      productId: product,
      relationshipId: p.sr.id,
      ownerId: demoUser,
      kind: "reply",
      title: "Fictional",
      reason: "",
      owedBy: "us",
      channel: "gmail",
      dueAt: new Date(),
      draft: "Fictional",
      draftHash: "hash",
      approvedHash: "hash",
      approvedBy: demoUser,
    })
    .returning();
  await new RecordService(local.db).mergeRecords(admin, p.input);
  const [moved] = await local.db
    .select()
    .from(s.actions)
    .where(eq(s.actions.id, action.id));
  expect(moved).toMatchObject({
    relationshipId: p.tr.id,
    ownerId: demoUser,
    approvedHash: null,
  });
  expect(moved.version).toBeGreaterThan(action.version);
});

test.skipIf(!serverUrl)(
  "refreshes membership after waiting on the organization lock",
  async () => {
    const p = await pair();
    if (!pg) throw new Error("PostgreSQL test requires a local server");
    const postgresClient = pg;
    let pending: Promise<PromiseSettledResult<unknown>> | undefined;
    try {
      await pg.begin(async (blocker) => {
        await blocker`SELECT id FROM organizations WHERE id=${org} FOR UPDATE`;
        pending = new RecordService(local.db)
          .mergeRecords(
            { ...admin, source: "mcp", readOnly: false, productIds: [product] },
            p.input,
          )
          .then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason) => ({ status: "rejected" as const, reason }),
          );
        await expect
          .poll(async () => {
            const rows =
              await postgresClient`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"organizations"%'`;
            return rows.length;
          })
          .toBeGreaterThan(0);
        await blocker`UPDATE memberships SET active=false WHERE organization_id=${org} AND user_id=${demoUser}`;
      });
      expect(await pending).toMatchObject({
        status: "rejected",
        reason: { code: "FORBIDDEN" },
      });
    } finally {
      await pending;
      await local.db
        .update(s.memberships)
        .set({ active: true })
        .where(eq(s.memberships.userId, demoUser));
    }
  },
);

test.skipIf(!serverUrl)(
  "simultaneous merges cannot reuse stale source versions",
  async () => {
    const p = await pair();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        new RecordService(local.db).mergeRecords(admin, p.input),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  },
);

test("moves owned drafts, internal tasks, evidence and integration links without changing private owners", async () => {
  const p = await pair();
  const owner = "demo-teammate";
  const [conversation] = await local.db
    .insert(s.conversations)
    .values({
      organizationId: org,
      productId: product,
      relationshipId: p.sr.id,
      ownerId: owner,
      visibility: "private",
      channel: "gmail",
      provenance: "native",
      externalThreadId: randomUUID(),
    })
    .returning();
  const [draft] = await local.db
    .insert(s.nativeDrafts)
    .values({
      organizationId: org,
      productId: product,
      relationshipId: p.sr.id,
      ownerId: owner,
      sourceConversationId: conversation.id,
      channel: "gmail",
      title: "Fictional draft",
      body: "Private fixture body",
      sourceId: randomUUID(),
      sourceHash: "a".repeat(64),
    })
    .returning();
  const [task] = await local.db
    .insert(s.internalTasks)
    .values({
      organizationId: org,
      productId: product,
      relationshipId: p.sr.id,
      ownerId: owner,
      title: "Fictional task",
      dueAt: new Date(),
      timeZone: "UTC",
    })
    .returning();
  const [evidence] = await local.db
    .insert(s.evidence)
    .values({
      organizationId: org,
      productId: product,
      relationshipId: p.sr.id,
      title: "Fictional evidence",
      excerpt: "Fictional excerpt",
      source: "fixture",
      classification: "fact",
    })
    .returning();
  const externalId = randomUUID();
  const [item] = await local.db
    .insert(s.integrationItems)
    .values({
      organizationId: org,
      productId: product,
      relationshipId: p.sr.id,
      connectionId: demoId(700),
      externalId,
      record: {
        externalId,
        kind: "message",
        title: "Fictional import",
        body: "Fixture",
        occurredAt: new Date().toISOString(),
        participants: [],
      },
    })
    .returning();
  const [bridge] = await local.db
    .insert(s.yoduSources)
    .values({
      organizationId: org,
      productId: product,
      label: "Fictional bridge",
      encryptedSecret: "fictional-unused-fixture",
      createdBy: demoUser,
    })
    .returning();
  const [binding] = await local.db
    .insert(s.yoduBindings)
    .values({
      organizationId: org,
      productId: product,
      sourceId: bridge.id,
      externalSubjectId: randomUUID(),
      relationshipId: p.sr.id,
      createdBy: owner,
    })
    .returning();
  await new RecordService(local.db).mergeRecords(admin, p.input);
  expect(
    (
      await local.db
        .select()
        .from(s.nativeDrafts)
        .where(eq(s.nativeDrafts.id, draft.id))
    )[0],
  ).toEqual({ ...draft, relationshipId: p.tr.id, version: draft.version + 1 });
  expect(
    (
      await local.db
        .select()
        .from(s.internalTasks)
        .where(eq(s.internalTasks.id, task.id))
    )[0],
  ).toEqual({ ...task, relationshipId: p.tr.id, version: task.version + 1 });
  expect(
    (
      await local.db
        .select()
        .from(s.evidence)
        .where(eq(s.evidence.id, evidence.id))
    )[0],
  ).toEqual({ ...evidence, relationshipId: p.tr.id });
  expect(
    (
      await local.db
        .select()
        .from(s.integrationItems)
        .where(eq(s.integrationItems.id, item.id))
    )[0],
  ).toEqual({ ...item, relationshipId: p.tr.id });
  expect(
    (
      await local.db
        .select()
        .from(s.yoduBindings)
        .where(eq(s.yoduBindings.id, binding.id))
    )[0],
  ).toEqual({
    ...binding,
    relationshipId: p.tr.id,
    version: binding.version + 1,
  });
  const hidden = await new CrmService(local.db).context(admin, org, p.tr.id);
  expect(hidden.conversations.some((c) => c.id === conversation.id)).toBe(
    false,
  );
  const visible = await new CrmService(local.db).context(
    { userId: owner, source: "session" },
    org,
    p.tr.id,
  );
  expect(visible.conversations.some((c) => c.id === conversation.id)).toBe(
    true,
  );
});

test.each(["source", "target"])(
  "company merges reject archived hidden %s employees with a stale MCP grant",
  async (side) => {
    const [target, source] = await local.db
      .insert(s.companies)
      .values([
        { organizationId: org, name: "Visible canonical" },
        { organizationId: org, name: "Visible duplicate" },
      ])
      .returning();
    const [a, b, hidden] = await local.db
      .insert(s.people)
      .values([
        {
          organizationId: org,
          name: "Visible canonical employee",
          companyId: target.id,
        },
        {
          organizationId: org,
          name: "Visible duplicate employee",
          companyId: source.id,
        },
        {
          organizationId: org,
          name: "Archived hidden employee",
          companyId: side === "source" ? source.id : target.id,
          archivedAt: new Date(),
        },
      ])
      .returning();
    await local.db.insert(s.relationships).values(
      [a, b, hidden].map((p) => ({
        organizationId: org,
        productId: p.id === hidden.id ? product : demoId(11),
        personId: p.id,
        ownerId: demoUser,
      })),
    );
    await expect(
      new RecordService(local.db).mergeRecords(
        {
          userId: "demo-restricted",
          source: "mcp",
          readOnly: false,
          productIds: [product, demoId(11)],
        },
        {
          organizationId: org,
          entity: "company",
          sourceId: source.id,
          sourceVersion: 1,
          targetId: target.id,
          targetVersion: 1,
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (
        await local.db.select().from(s.people).where(eq(s.people.id, hidden.id))
      )[0],
    ).toEqual(hidden);
  },
);

test("merge schema rejects invalid contact time zones", () => {
  const operation = apiOperation("crm", "POST", "merge-records");
  expect(
    operation.schema.safeParse({
      organizationId: org,
      entity: "person",
      targetId: randomUUID(),
      sourceId: randomUUID(),
      targetVersion: 1,
      sourceVersion: 1,
      timeZone: "not/a/timezone",
    }).success,
  ).toBe(false);
});

test("merge keeps editable structured fields valid while retaining overflow in history", async () => {
  const p = await pair();
  const fields = Array.from({ length: 50 }, (_, index) => ({
    id: randomUUID(),
    label: `Field ${index}`,
    type: "text" as const,
    value: `Value ${index}`,
  }));
  await local.db
    .update(s.relationships)
    .set({ contextDetails: { ...emptyRelationshipDetails(), fields } })
    .where(eq(s.relationships.id, p.sr.id));
  await local.db
    .update(s.relationships)
    .set({
      contextDetails: {
        ...emptyRelationshipDetails(),
        fields: [
          {
            id: randomUUID(),
            label: "Canonical field",
            type: "text",
            value: "Canonical",
          },
        ],
      },
    })
    .where(eq(s.relationships.id, p.tr.id));
  await new RecordService(local.db).mergeRecords(admin, p.input);
  const [merged] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, p.tr.id));
  expect(
    relationshipDetailsSchema.safeParse(merged.contextDetails).success,
  ).toBe(true);
  expect(merged.mergeHistory).toEqual([
    expect.objectContaining({
      contextDetails: expect.objectContaining({ fields }),
    }),
  ]);
});
