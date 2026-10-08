import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle as localDrizzle } from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import { migrate as postgresMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ingestReply } from "../packages/connectors/replies";
import { YoduService } from "../packages/connectors/yodu";
import { CrmService, opportunitySchema } from "../packages/core/crm";
import {
  createInternalTaskSchema,
  InternalTaskService,
} from "../packages/core/internal-tasks";
import { OutreachService } from "../packages/core/outreach";
import type { Principal } from "../packages/core/policy";
import {
  opportunityArchiveSchema,
  RecordService,
} from "../packages/core/records";
import {
  createLocalDatabase,
  type Database,
} from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";

const admin: Principal = { userId: demoUser, source: "demo" };
const org = demoId(1);
const sentAt = "2026-10-05T05:00:00.000Z";
const repliedAt = "2026-10-05T07:00:00.000Z";

const outreachOn = (db: Database) =>
  new OutreachService(db, () => Date.parse("2026-10-05T06:00:00Z"));

async function enrolledTouch(db: Database, label: string, ownerId = demoUser) {
  const crm = new CrmService(db);
  const outreach = outreachOn(db);
  const product = await crm.createProduct(admin, org, `Driver ${label}`);
  const email = `driver-${label}@example.test`;
  const person = await crm.createPerson(admin, {
    organizationId: org,
    productId: product.id,
    name: `Driver person ${label}`,
    email,
    title: "",
    purpose: "buyer",
    context: "",
    review: false,
    channel: "gmail",
  });
  await db
    .update(s.relationships)
    .set({ ownerId })
    .where(eq(s.relationships.id, person.relationshipId));
  const [sequence] = await db
    .insert(s.sequences)
    .values({
      organizationId: org,
      productId: product.id,
      name: "Driver sequence",
      steps: [0, 3].map((delayDays, index) => ({
        number: index + 1,
        name: `Step ${index + 1}`,
        delayDays,
        channel: "gmail" as const,
        template: "Fictional template",
        followUp: index,
      })),
    })
    .returning();
  if (!sequence) throw new Error("missing sequence");
  await outreach.enroll(admin, {
    organizationId: org,
    sequenceId: sequence.id,
    relationshipIds: [person.relationshipId],
    dryRun: false,
  });
  const [touch] = await db
    .select()
    .from(s.touches)
    .where(eq(s.touches.relationshipId, person.relationshipId));
  if (!touch) throw new Error("missing touch");
  return { touch, email, relationshipId: person.relationshipId };
}

async function sendAndReply(db: Database, label: string) {
  const { touch, email, relationshipId } = await enrolledTouch(db, label);
  await outreachOn(db).markSent(admin, {
    organizationId: org,
    touchId: touch.id,
    sentAt,
  });
  await ingestReply(db, {
    provider: "gmail",
    accountId: "demo-gmail",
    messageId: `driver-reply-${label}`,
    threadId: `driver-thread-${label}`,
    direction: "inbound",
    channel: "gmail",
    body: "Fictional reply",
    occurredAt: repliedAt,
    from: email,
  });
  const [relationship] = await db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, relationshipId));
  const [enrollment] = await db
    .select()
    .from(s.enrollments)
    .where(eq(s.enrollments.relationshipId, relationshipId));
  return { relationship, enrollment };
}

function expectRecorded(result: Awaited<ReturnType<typeof sendAndReply>>) {
  expect(result.relationship?.lastOutboundAt).toEqual(new Date(sentAt));
  expect(result.relationship?.lastInboundAt).toEqual(new Date(repliedAt));
  expect(result.enrollment).toMatchObject({
    status: "paused",
    pauseReason: "reply",
  });
}

describe("contact timestamps reach the driver as text", () => {
  let local: Awaited<ReturnType<typeof createLocalDatabase>>;
  beforeAll(async () => {
    local = await createLocalDatabase();
    await seedDemo(local.db);
  });
  afterAll(async () => local.client.close());

  test("markSent and a matched reply bind no Date object as a raw parameter", async () => {
    const dateParams: string[] = [];
    const watched = localDrizzle(local.client, {
      schema: s,
      logger: {
        logQuery(query, params) {
          if (params.some((param) => param instanceof Date))
            dateParams.push(query);
        },
      },
    });
    expectRecorded(await sendAndReply(watched, "guard"));
    expect(dateParams).toEqual([]);
  });
});

const serverUrl = process.env.GRAVITY_POSTGRES_TEST_URL ?? "";
const localHosts = ["localhost", "127.0.0.1", "::1", "[::1]"];
const usableServer =
  serverUrl !== "" && localHosts.includes(new URL(serverUrl).hostname);
if (!usableServer)
  console.info(
    "Skipping the postgres-js outreach test: set GRAVITY_POSTGRES_TEST_URL to a local Postgres superuser URL to run it.",
  );

describe.skipIf(!usableServer)("outreach on the production driver", () => {
  const name = `gravity_crm_driver_${randomUUID().replaceAll("-", "")}`;
  let server: postgres.Sql;
  let client: postgres.Sql;
  let createdRole = false;
  beforeAll(async () => {
    server = postgres(serverUrl, { max: 1, onnotice: () => {} });
    const [role] =
      await server`SELECT 1 FROM pg_roles WHERE rolname = 'gravity_app'`;
    createdRole = !role;
    await server.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 4, onnotice: () => {} });
    const db = postgresDrizzle(client, { schema: s });
    await postgresMigrate(db, {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
    await seedDemo(db);
  }, 120000);
  afterAll(async () => {
    await client?.end();
    await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    if (createdRole) await server.unsafe("DROP ROLE IF EXISTS gravity_app");
    await server.end();
  }, 60000);

  async function waitForManagementLock(blockerPid: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await client`
        SELECT pid, query FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> ${blockerPid}
          AND wait_event_type = 'Lock'
          AND (query LIKE '%"organizations"%' OR query LIKE '%"products"%')
      `;
      if (rows.length) return rows[0];
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      "Management operation did not reach its database lock wait",
    );
  }

  test("Yodu creation loses administrator authority while a separate transaction holds its locks", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "cd".repeat(32));
    const db = postgresDrizzle(client, { schema: s });
    const sourceId = randomUUID();
    let pending: Promise<PromiseSettledResult<unknown>> | undefined;
    try {
      await client.begin(async (blocker) => {
        const [backend] = await blocker`SELECT pg_backend_pid() AS pid`;
        await blocker`SELECT id FROM organizations WHERE id = ${org} FOR UPDATE`;
        await blocker`SELECT id FROM products WHERE id = ${demoId(10)} FOR UPDATE`;
        pending = new YoduService(db)
          .createSource(
            {
              ...admin,
              source: "mcp",
              organizationId: org,
              productIds: [demoId(10)],
              readOnly: false,
            },
            {
              organizationId: org,
              productId: demoId(10),
              sourceId,
              label: "Fictional blocked source",
            },
          )
          .then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason) => ({ status: "rejected" as const, reason }),
          );
        expect(await waitForManagementLock(backend.pid)).toBeDefined();
        // Keep product access so only the freshly demoted administrator role
        // denies the operation after the blocker commits.
        await blocker`INSERT INTO product_memberships (organization_id, product_id, user_id) VALUES (${org}, ${demoId(10)}, ${demoUser}) ON CONFLICT DO NOTHING`;
        await blocker`UPDATE memberships SET role = 'member' WHERE organization_id = ${org} AND user_id = ${demoUser}`;
      });
      expect(await pending).toMatchObject({
        status: "rejected",
        reason: { code: "FORBIDDEN" },
      });
      expect(
        await db
          .select()
          .from(s.yoduSources)
          .where(eq(s.yoduSources.id, sourceId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(s.changeEvents)
          .where(eq(s.changeEvents.entityId, sourceId)),
      ).toEqual([]);
    } finally {
      await pending;
      await db
        .update(s.memberships)
        .set({ role: "admin", active: true })
        .where(
          and(
            eq(s.memberships.organizationId, org),
            eq(s.memberships.userId, demoUser),
          ),
        );
      vi.unstubAllEnvs();
    }
  });

  test("internal task creation loses its product grant while a separate transaction holds its locks", async () => {
    const db = postgresDrizzle(client, { schema: s });
    const title = `Fictional blocked task ${randomUUID()}`;
    let pending: Promise<PromiseSettledResult<unknown>> | undefined;
    await db
      .insert(s.productMemberships)
      .values({ organizationId: org, productId: demoId(10), userId: demoUser })
      .onConflictDoNothing();
    await db
      .update(s.memberships)
      .set({ role: "member" })
      .where(
        and(
          eq(s.memberships.organizationId, org),
          eq(s.memberships.userId, demoUser),
        ),
      );
    try {
      await client.begin(async (blocker) => {
        const [backend] = await blocker`SELECT pg_backend_pid() AS pid`;
        await blocker`SELECT id FROM organizations WHERE id = ${org} FOR UPDATE`;
        await blocker`SELECT id FROM products WHERE id = ${demoId(10)} FOR UPDATE`;
        pending = new InternalTaskService(db)
          .create(
            admin,
            createInternalTaskSchema.parse({
              organizationId: org,
              productId: demoId(10),
              ownerId: demoUser,
              title,
              dueAt: "2026-10-08T12:00:00Z",
              timeZone: "UTC",
            }),
          )
          .then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason) => ({ status: "rejected" as const, reason }),
          );
        expect(await waitForManagementLock(backend.pid)).toBeDefined();
        await blocker`DELETE FROM product_memberships WHERE organization_id = ${org} AND product_id = ${demoId(10)} AND user_id = ${demoUser}`;
      });
      expect(await pending).toMatchObject({
        status: "rejected",
        reason: { code: "FORBIDDEN" },
      });
      expect(
        await db
          .select()
          .from(s.internalTasks)
          .where(eq(s.internalTasks.title, title)),
      ).toEqual([]);
    } finally {
      await pending;
      await db
        .update(s.memberships)
        .set({ role: "admin", active: true })
        .where(
          and(
            eq(s.memberships.organizationId, org),
            eq(s.memberships.userId, demoUser),
          ),
        );
    }
  });

  test.each(["archive", "full save"])(
    "deal %s loses actor membership while a separate transaction holds its locks",
    async (operation) => {
      const db = postgresDrizzle(client, { schema: s });
      const crm = new CrmService(db);
      const deal = await crm.saveOpportunity(
        admin,
        opportunitySchema.parse({
          organizationId: org,
          productId: demoId(10),
          relationshipId: demoId(300),
          stageId: demoId(800),
          name: `Fictional blocked deal ${randomUUID()}`,
          ownerId: demoUser,
          amountMinor: 12000,
          currency: "USD",
          probability: 50,
          description: "Fictional deal retained after access revocation",
        }),
      );
      const actor: Principal = {
        userId: "demo-teammate",
        source: "session",
      };
      let pending: Promise<PromiseSettledResult<unknown>> | undefined;
      try {
        await client.begin(async (blocker) => {
          const [backend] = await blocker`SELECT pg_backend_pid() AS pid`;
          await blocker`SELECT id FROM organizations WHERE id = ${org} FOR UPDATE`;
          await blocker`SELECT id FROM products WHERE id = ${demoId(10)} FOR UPDATE`;
          const mutation =
            operation === "archive"
              ? new RecordService(db).archiveOpportunity(
                  actor,
                  opportunityArchiveSchema.parse({
                    organizationId: org,
                    productId: deal.productId,
                    opportunityId: deal.id,
                    version: deal.version,
                    archived: true,
                  }),
                )
              : crm.saveOpportunity(
                  actor,
                  opportunitySchema.parse({
                    ...deal,
                    name: "Fictional revoked full save",
                  }),
                );
          pending = mutation.then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason) => ({ status: "rejected" as const, reason }),
          );
          const waiting = await waitForManagementLock(backend.pid);
          expect(waiting?.query).toContain('"organizations"');
          await blocker`UPDATE memberships SET active = false WHERE organization_id = ${org} AND user_id = ${actor.userId}`;
        });
        expect(await pending).toMatchObject({
          status: "rejected",
          reason: { code: "FORBIDDEN" },
        });
        expect(
          await db
            .select()
            .from(s.opportunities)
            .where(eq(s.opportunities.id, deal.id)),
        ).toEqual([deal]);
        expect(
          await db
            .select({ type: s.changeEvents.type })
            .from(s.changeEvents)
            .where(eq(s.changeEvents.entityId, deal.id)),
        ).toEqual([{ type: "opportunity.created" }]);
      } finally {
        await pending;
        await db
          .update(s.memberships)
          .set({ active: true })
          .where(
            and(
              eq(s.memberships.organizationId, org),
              eq(s.memberships.userId, actor.userId),
            ),
          );
      }
    },
  );

  test("reply ingestion waits for the organization before locking an account needed by a concurrent update", async () => {
    const db = postgresDrizzle(client, { schema: s });
    const messageId = `fictional-lock-order-${randomUUID()}`;
    let pending: Promise<PromiseSettledResult<unknown>> | undefined;
    try {
      await client.begin(async (blocker) => {
        await blocker`SET LOCAL lock_timeout = '1500ms'`;
        const [backend] = await blocker`SELECT pg_backend_pid() AS pid`;
        await blocker`SELECT id FROM organizations WHERE id = ${org} FOR UPDATE`;
        pending = ingestReply(db, {
          provider: "gmail",
          accountId: "demo-gmail",
          connectionId: demoId(700),
          messageId,
          threadId: `fictional-unmatched-${randomUUID()}`,
          direction: "inbound",
          channel: "gmail",
          body: "Fictional reply retained while account settings change",
          occurredAt: repliedAt,
          from: "fictional-unmatched@example.test",
        }).then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason) => ({ status: "rejected" as const, reason }),
        );
        const waiting = await waitForManagementLock(backend.pid);
        expect(waiting?.query).toContain('"organizations"');
        // An account-first ingestion lock would now form a real deadlock:
        // this writer owns the organization and needs ingestion's account.
        await blocker`SELECT id FROM connections WHERE id = ${demoId(700)} FOR UPDATE`;
        await blocker`UPDATE connections SET display_name = 'Fictional concurrently updated account' WHERE id = ${demoId(700)}`;
      });
      expect(await pending).toMatchObject({
        status: "fulfilled",
        value: { matched: false },
      });
      const [receipt] = await db
        .select()
        .from(s.connectorEvents)
        .where(eq(s.connectorEvents.providerEventId, messageId));
      expect(receipt).toMatchObject({
        organizationId: org,
        connectionId: demoId(700),
      });
    } finally {
      await pending;
    }
  });

  test("markSent and a matched reply record contact times through postgres-js", async () => {
    expectRecorded(
      await sendAndReply(postgresDrizzle(client, { schema: s }), "server"),
    );
  });

  test("two sends racing on one message id end in a conflict, never a server error", async () => {
    const db = postgresDrizzle(client, { schema: s });
    const first = await enrolledTouch(db, "race-a");
    const second = await enrolledTouch(db, "race-b", "demo-teammate");
    const results = await Promise.allSettled(
      [first, second].map(({ touch }) =>
        outreachOn(db).markSent(admin, {
          organizationId: org,
          touchId: touch.id,
          externalMessageId: "raced-message-id",
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      ),
    ).toEqual([expect.objectContaining({ code: "EXTERNAL_MESSAGE_REPORTED" })]);
  });
});
