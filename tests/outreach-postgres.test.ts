import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle as localDrizzle } from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import { migrate as postgresMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ingestReply } from "../packages/connectors/replies";
import { CrmService } from "../packages/core/crm";
import { OutreachService } from "../packages/core/outreach";
import type { Principal } from "../packages/core/policy";
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

async function sendAndReply(db: Database, label: string) {
  const crm = new CrmService(db);
  const outreach = new OutreachService(db, () =>
    Date.parse("2026-10-05T06:00:00Z"),
  );
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
  await outreach.markSent(admin, {
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
    .where(eq(s.relationships.id, person.relationshipId));
  const [enrollment] = await db
    .select()
    .from(s.enrollments)
    .where(eq(s.enrollments.relationshipId, person.relationshipId));
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
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let createdRole = false;
  beforeAll(async () => {
    admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
    const [role] =
      await admin`SELECT 1 FROM pg_roles WHERE rolname = 'gravity_app'`;
    createdRole = !role;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 1, onnotice: () => {} });
    const db = postgresDrizzle(client, { schema: s });
    await postgresMigrate(db, {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
    await seedDemo(db);
  }, 120000);
  afterAll(async () => {
    await client?.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    if (createdRole) await admin.unsafe("DROP ROLE IF EXISTS gravity_app");
    await admin.end();
  }, 60000);

  test("markSent and a matched reply record contact times through postgres-js", async () => {
    expectRecorded(
      await sendAndReply(postgresDrizzle(client, { schema: s }), "server"),
    );
  });
});
