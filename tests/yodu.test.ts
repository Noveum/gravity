import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import {
  verifyYoduSignature,
  YoduService,
  yoduEventSchema,
} from "../packages/connectors/yodu";
import type { Principal } from "../packages/core/policy";
import type { Database } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  apiOperation,
  operationInput,
  operationRequirements,
  operations,
} from "../packages/operations/catalog";
import { databaseWithLockInterleave } from "./support/lock-interleave";

let db: Database;
let demo = false;
vi.mock("@crm/database/client", async (original) => ({
  ...(await original<object>()),
  getDatabase: async () => db,
  isDemoMode: () => demo,
}));

import { POST as webhook } from "../src/app/api/webhooks/yodu/route";

let local: Awaited<
  ReturnType<
    typeof import("../packages/database/client")["createLocalDatabase"]
  >
>;
const org = demoId(1);
const product = demoId(10);
const scope = { organizationId: org, productId: product };
const human: Principal = { userId: demoUser, source: "session" };
const writer: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId: org,
  productIds: [product],
  readOnly: false,
};
const now = Date.parse("2026-10-08T12:00:00Z");
const service = () => new YoduService(db, () => now);
const bytes = (body: unknown) => new TextEncoder().encode(JSON.stringify(body));
function signature(raw: Uint8Array, secret: string, clock = now) {
  const timestamp = Math.floor(clock / 1000);
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}
function event(
  kind: "signup" | "onboarding" | "payment" | "activation" = "signup",
  eventId = randomUUID(),
) {
  return {
    eventId,
    externalSubjectId: "fictional-workspace",
    kind,
    occurredAt: "2026-10-08T11:59:00+00:00",
  };
}
async function source() {
  const result = await service().createSource(human, {
    ...scope,
    sourceId: randomUUID(),
    label: "Fictional Yodu backend",
  });
  if (!("signingSecret" in result) || !result.signingSecret)
    throw new Error("Missing fixture secret");
  return { ...result, signingSecret: result.signingSecret };
}
beforeAll(async () => {
  const module = await vi.importActual<
    typeof import("../packages/database/client")
  >("../packages/database/client");
  local = await module.createLocalDatabase();
  db = local.db;
  await seedDemo(db);
});
afterAll(async () => local.client.close());
beforeEach(() => {
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("APP_URL", "https://gravity.example.test");
  demo = false;
});
afterEach(() => vi.unstubAllEnvs());

test("Yodu signatures bind exact bytes, timestamp and source secret", () => {
  const raw = bytes(event());
  const secret = "fictional-yodu-signing-secret";
  expect(verifyYoduSignature(raw, signature(raw, secret), secret, now)).toBe(
    true,
  );
  expect(
    verifyYoduSignature(raw, signature(raw, secret, now - 300001), secret, now),
  ).toBe(false);
  expect(
    verifyYoduSignature(raw, signature(raw, secret, now + 301000), secret, now),
  ).toBe(false);
  expect(
    verifyYoduSignature(
      bytes({ ...event(), kind: "payment" }),
      signature(raw, secret),
      secret,
      now,
    ),
  ).toBe(false);
  expect(
    verifyYoduSignature(
      raw,
      signature(raw, secret),
      "another-fictional-secret",
      now,
    ),
  ).toBe(false);
  expect(verifyYoduSignature(raw, "t=NaN,v1=bad", secret, now)).toBe(false);
  expect(verifyYoduSignature(raw, null, secret, now)).toBe(false);
});

test("stable source creation recovers ambiguous retries without exposing stored credentials", async () => {
  const saved = await source();
  expect(saved.webhookUrl).toBe(
    `https://gravity.example.test/api/webhooks/yodu?sourceId=${saved.id}`,
  );
  const repeat = await service().createSource(writer, {
    ...scope,
    sourceId: saved.id,
    label: saved.label,
  });
  expect(repeat).toMatchObject({ id: saved.id, created: false });
  expect(repeat).not.toHaveProperty("signingSecret");
  const overview = await service().sources(writer, scope);
  expect(overview.canManage).toBe(true);
  expect(JSON.stringify(overview)).not.toContain(saved.signingSecret);
  expect(JSON.stringify(overview)).not.toContain("encryptedSecret");
  await expect(
    service().createSource(human, {
      ...scope,
      sourceId: saved.id,
      label: "Different backend",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const [stored] = await db
    .select()
    .from(s.yoduSources)
    .where(eq(s.yoduSources.id, saved.id));
  expect(stored.encryptedSecret).not.toContain(saved.signingSecret);
});

test("uppercase UUID creation and retries preserve encrypted source identity", async () => {
  const sourceId = randomUUID().toUpperCase();
  const saved = await service().createSource(writer, {
    ...scope,
    sourceId,
    label: "Fictional uppercase source",
  });
  if (!("signingSecret" in saved) || !saved.signingSecret)
    throw new Error("Missing fixture secret");
  expect(saved.id).toBe(sourceId.toLowerCase());
  const raw = bytes(event());
  expect(
    await service().ingest(sourceId, raw, signature(raw, saved.signingSecret)),
  ).toMatchObject({ received: true, duplicate: false });
  expect(
    await service().createSource(writer, {
      ...scope,
      sourceId,
      label: saved.label,
    }),
  ).toMatchObject({ id: saved.id, created: false });
});

test("a granted product administrator cannot address another product's source, mapping or receipts", async () => {
  const saved = await source();
  const otherScope = { organizationId: org, productId: demoId(11) };
  const restricted: Principal = {
    ...writer,
    productIds: [otherScope.productId],
  };
  expect((await service().sources(restricted, otherScope)).canManage).toBe(
    true,
  );
  await expect(
    service().updateSource(restricted, {
      ...otherScope,
      sourceId: saved.id,
      version: saved.version,
      enabled: false,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    service().bindSubject(restricted, {
      ...otherScope,
      sourceId: saved.id,
      externalSubjectId: "fictional-workspace",
      relationshipId: demoId(301),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await service().events(restricted, { ...otherScope, sourceId: saved.id }))
      .events,
  ).toEqual([]);
});

test("source provenance survives creator revocation while former members lose business access", async () => {
  const saved = await source();
  await db
    .update(s.memberships)
    .set({ active: false })
    .where(
      and(
        eq(s.memberships.organizationId, org),
        eq(s.memberships.userId, demoUser),
      ),
    );
  try {
    await expect(service().sources(writer, scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      service().updateSource(writer, {
        ...scope,
        sourceId: saved.id,
        version: saved.version,
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const raw = bytes(event());
    expect(
      await service().ingest(
        saved.id,
        raw,
        signature(raw, saved.signingSecret),
      ),
    ).toMatchObject({ received: true, duplicate: false });
  } finally {
    await db
      .update(s.memberships)
      .set({ active: true })
      .where(
        and(
          eq(s.memberships.organizationId, org),
          eq(s.memberships.userId, demoUser),
        ),
      );
  }
});

test("archived-person evidence retains the same legacy MCP boundary as CRM history", async () => {
  const saved = await source();
  await service().bindSubject(writer, {
    ...scope,
    sourceId: saved.id,
    externalSubjectId: "fictional-workspace",
    relationshipId: demoId(300),
  });
  const raw = bytes(event());
  await service().ingest(saved.id, raw, signature(raw, saved.signingSecret));
  const reader: Principal = { ...writer, readOnly: true };
  await db
    .update(s.people)
    .set({ archivedAt: new Date(now) })
    .where(eq(s.people.id, demoId(200)));
  try {
    expect(
      (await service().events(human, { ...scope, sourceId: saved.id })).events,
    ).toHaveLength(1);
    expect(
      (
        await service().events(writer, {
          ...scope,
          relationshipId: demoId(300),
          sourceId: saved.id,
        })
      ).events,
    ).toHaveLength(1);
    expect(
      (await service().events(reader, { ...scope, sourceId: saved.id })).events,
    ).toEqual([]);
    expect(
      (await service().sources(reader, scope)).bindings.filter(
        (binding) => binding.sourceId === saved.id,
      ),
    ).toEqual([]);
    await expect(
      service().events(reader, { ...scope, relationshipId: demoId(300) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service().bindSubject(writer, {
        ...scope,
        sourceId: saved.id,
        externalSubjectId: "fictional-new-subject",
        relationshipId: demoId(300),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await db
      .update(s.people)
      .set({ archivedAt: null })
      .where(eq(s.people.id, demoId(200)));
  }
});

test("all four source-attested lifecycle kinds are durable, deduplicated and cause no sending or action changes", async () => {
  const saved = await source();
  const beforeActions = await db.select().from(s.actions);
  const beforeTouches = await db.select().from(s.touches);
  const beforeDeliveries = await db.select().from(s.deliveries);
  const originals: Uint8Array[] = [];
  for (const kind of [
    "signup",
    "onboarding",
    "payment",
    "activation",
  ] as const) {
    const raw = bytes(event(kind));
    originals.push(raw);
    const first = await service().ingest(
      saved.id,
      raw,
      signature(raw, saved.signingSecret),
    );
    const repeat = await service().ingest(
      saved.id,
      raw,
      signature(raw, saved.signingSecret),
    );
    expect(repeat).toEqual({ ...first, duplicate: true });
  }
  const unmatched = await service().events(writer, {
    ...scope,
    sourceId: saved.id,
    unmatched: "true",
  });
  expect(unmatched.events).toHaveLength(4);
  expect(
    unmatched.events.every(
      (item) =>
        item.verification === "signed_source_attestation" &&
        item.relationshipId === null,
    ),
  ).toBe(true);
  const firstValue = JSON.parse(new TextDecoder().decode(originals[0]));
  const changed = bytes({ ...firstValue, kind: "payment" });
  await expect(
    service().ingest(
      saved.id,
      changed,
      signature(changed, saved.signingSecret),
    ),
  ).rejects.toMatchObject({ code: "YODU_EVENT_CONFLICT", status: 409 });
  expect(await db.select().from(s.actions)).toEqual(beforeActions);
  expect(await db.select().from(s.touches)).toEqual(beforeTouches);
  expect(await db.select().from(s.deliveries)).toEqual(beforeDeliveries);
  const changes = await db
    .select()
    .from(s.changeEvents)
    .where(
      and(
        eq(s.changeEvents.entityId, unmatched.events[0].id),
        eq(s.changeEvents.type, "yodu.event_received"),
      ),
    );
  expect(changes).toHaveLength(1);
  expect(
    await db
      .select()
      .from(s.yoduEvents)
      .where(eq(s.yoduEvents.sourceId, saved.id)),
  ).toHaveLength(4);
});

test("untrusted verification flags, tenant selectors and guessed CRM identities cannot create events", async () => {
  const saved = await source();
  for (const extra of [
    { verified: true },
    { organizationId: org },
    { relationshipId: demoId(300) },
    { email: "fictional@example.test" },
  ]) {
    const raw = bytes({ ...event(), ...extra });
    await expect(
      service().ingest(saved.id, raw, signature(raw, saved.signingSecret)),
    ).rejects.toBeInstanceOf(Error);
  }
  expect(
    yoduEventSchema.safeParse({ ...event(), occurredAt: "2026-10-08" }).success,
  ).toBe(false);
  const future = bytes({ ...event(), occurredAt: "2026-10-09T12:00:00Z" });
  await expect(
    service().ingest(saved.id, future, signature(future, saved.signingSecret)),
  ).rejects.toMatchObject({ code: "YODU_EVENT_FUTURE" });
  expect(
    await db
      .select()
      .from(s.yoduEvents)
      .where(eq(s.yoduEvents.sourceId, saved.id)),
  ).toEqual([]);
});

test("signed occurrence times preserve offset milliseconds and reject unsupported precision", async () => {
  const saved = await source();
  for (const occurredAt of [
    "2026-10-08T10:15:00.1234Z",
    "2026-10-08T10:15:00.123456+05:30",
  ]) {
    const value = { ...event("payment"), occurredAt };
    expect(yoduEventSchema.safeParse(value).success).toBe(false);
    const raw = bytes(value);
    await expect(
      service().ingest(saved.id, raw, signature(raw, saved.signingSecret)),
    ).rejects.toMatchObject({ name: "ZodError" });
  }
  expect(
    (await service().events(writer, { ...scope, sourceId: saved.id })).events,
  ).toEqual([]);

  const raw = bytes({
    ...event("payment"),
    occurredAt: "2026-10-08T10:15:00.789+05:30",
  });
  await service().ingest(saved.id, raw, signature(raw, saved.signingSecret));
  const page = await service().events(writer, {
    ...scope,
    sourceId: saved.id,
  });
  expect(page.events).toHaveLength(1);
  expect(page.events[0].occurredAt.toISOString()).toBe(
    "2026-10-08T04:45:00.789Z",
  );
});

test("explicit versioned subject association enforces tenant/product boundaries and preserves immutable receipts", async () => {
  const saved = await source();
  const raw = bytes(event());
  await service().ingest(saved.id, raw, signature(raw, saved.signingSecret));
  const original = await db
    .select()
    .from(s.yoduEvents)
    .where(eq(s.yoduEvents.sourceId, saved.id));
  await expect(
    service().bindSubject(writer, {
      ...scope,
      sourceId: saved.id,
      externalSubjectId: "fictional-workspace",
      relationshipId: demoId(301),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    service().bindSubject(writer, {
      ...scope,
      sourceId: saved.id,
      externalSubjectId: "fictional-workspace",
      relationshipId: demoId(307),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const binding = await service().bindSubject(writer, {
    ...scope,
    sourceId: saved.id,
    externalSubjectId: "fictional-workspace",
    relationshipId: demoId(300),
  });
  expect(
    (
      await service().events(writer, {
        ...scope,
        sourceId: saved.id,
        relationshipId: demoId(300),
      })
    ).events,
  ).toHaveLength(1);
  expect(
    (
      await service().events(writer, {
        ...scope,
        sourceId: saved.id,
        unmatched: "true",
      })
    ).events,
  ).toEqual([]);
  await expect(
    service().bindSubject(writer, {
      ...scope,
      sourceId: saved.id,
      externalSubjectId: "fictional-workspace",
      relationshipId: demoId(304),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const updated = await service().bindSubject(writer, {
    ...scope,
    sourceId: saved.id,
    externalSubjectId: "fictional-workspace",
    relationshipId: demoId(304),
    expectedVersion: binding.version,
  });
  expect(updated.version).toBe(binding.version + 1);
  await expect(
    service().bindSubject(writer, {
      ...scope,
      sourceId: saved.id,
      externalSubjectId: "fictional-workspace",
      relationshipId: demoId(300),
      expectedVersion: binding.version,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (
      await service().events(writer, {
        ...scope,
        sourceId: saved.id,
        relationshipId: demoId(300),
      })
    ).events,
  ).toHaveLength(0);
  expect(
    (
      await service().events(writer, {
        ...scope,
        sourceId: saved.id,
        relationshipId: demoId(304),
      })
    ).events,
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(s.yoduEvents)
      .where(eq(s.yoduEvents.sourceId, saved.id)),
  ).toEqual(original);
});

test("source management and reads recheck current membership and immutable MCP organization/product grants", async () => {
  const saved = await source();
  const readOnly: Principal = { ...writer, readOnly: true };
  expect((await service().sources(readOnly, scope)).canManage).toBe(false);
  await expect(
    service().updateSource(readOnly, {
      ...scope,
      sourceId: saved.id,
      version: saved.version,
      enabled: false,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    service().sources({ ...writer, productIds: [demoId(11)] }, scope),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    service().events({ ...writer, organizationId: demoId(2) }, scope),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const member: Principal = { userId: "demo-teammate", source: "session" };
  await expect(
    service().createSource(member, {
      ...scope,
      sourceId: randomUUID(),
      label: "Unauthorized source",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db
    .update(s.memberships)
    .set({ active: false })
    .where(
      and(
        eq(s.memberships.organizationId, org),
        eq(s.memberships.userId, demoUser),
      ),
    );
  try {
    await expect(service().events(writer, scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  } finally {
    await db
      .update(s.memberships)
      .set({ active: true })
      .where(
        and(
          eq(s.memberships.organizationId, org),
          eq(s.memberships.userId, demoUser),
        ),
      );
  }
});

test.each([
  ["create", "demoted"],
  ["create", "removed"],
  ["rotate", "demoted"],
  ["rotate", "removed"],
  ["bind", "demoted"],
  ["bind", "removed"],
] as const)(
  "%s rechecks administrator authority after a %s membership wins the lock wait",
  async (operation, change) => {
    const saved = await source();
    const beforeSources = await db.select().from(s.yoduSources);
    const beforeBindings = await db.select().from(s.yoduBindings);
    const beforeChanges = await db.select().from(s.changeEvents);
    let lockSql = "";
    const barrier = databaseWithLockInterleave(db, async (tx, sql) => {
      lockSql = sql;
      await tx
        .update(s.memberships)
        .set(change === "demoted" ? { role: "member" } : { active: false })
        .where(
          and(
            eq(s.memberships.organizationId, org),
            eq(s.memberships.userId, demoUser),
          ),
        );
      // Demotion retains product access, so the fresh role check must also deny.
      if (change === "demoted")
        await tx
          .insert(s.productMemberships)
          .values({ ...scope, userId: demoUser })
          .onConflictDoNothing();
    });
    const guarded = new YoduService(barrier.database, () => now);
    const run =
      operation === "create"
        ? guarded.createSource(human, {
            ...scope,
            sourceId: randomUUID(),
            label: "Fictional revoked administrator source",
          })
        : operation === "rotate"
          ? guarded.updateSource(writer, {
              ...scope,
              sourceId: saved.id,
              version: saved.version,
              rotateSecret: true,
            })
          : guarded.bindSubject(human, {
              ...scope,
              sourceId: saved.id,
              externalSubjectId: "fictional-revoked-administrator-subject",
              relationshipId: demoId(300),
            });
    await expect(run).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(barrier.didInterleave()).toBe(true);
    expect(lockSql).toContain('from "organizations"');
    expect(lockSql).toContain("for share");
    expect(await db.select().from(s.yoduSources)).toEqual(beforeSources);
    expect(await db.select().from(s.yoduBindings)).toEqual(beforeBindings);
    expect(await db.select().from(s.changeEvents)).toEqual(beforeChanges);
  },
);

test("rotation, disable and product archival close ingress without erasing previously authenticated facts", async () => {
  const saved = await source();
  const raw = bytes(event());
  await service().ingest(saved.id, raw, signature(raw, saved.signingSecret));
  const rotated = await service().updateSource(writer, {
    ...scope,
    sourceId: saved.id,
    version: saved.version,
    rotateSecret: true,
  });
  if (!rotated.signingSecret) throw new Error("Missing rotated fixture secret");
  await expect(
    service().ingest(
      saved.id,
      bytes(event()),
      signature(bytes(event()), saved.signingSecret),
    ),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const next = bytes(event("activation"));
  await service().ingest(
    saved.id,
    next,
    signature(next, rotated.signingSecret),
  );
  const disabled = await service().updateSource(writer, {
    ...scope,
    sourceId: saved.id,
    version: rotated.version,
    enabled: false,
  });
  await expect(
    service().ingest(saved.id, next, signature(next, rotated.signingSecret)),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(
    service().updateSource(writer, {
      ...scope,
      sourceId: saved.id,
      version: rotated.version,
      enabled: true,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await service().updateSource(writer, {
    ...scope,
    sourceId: saved.id,
    version: disabled.version,
    enabled: true,
  });
  await db
    .update(s.products)
    .set({ archivedAt: new Date(now) })
    .where(eq(s.products.id, product));
  try {
    await expect(
      service().ingest(saved.id, next, signature(next, rotated.signingSecret)),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  } finally {
    await db
      .update(s.products)
      .set({ archivedAt: null })
      .where(eq(s.products.id, product));
  }
  expect(
    (await service().events(writer, { ...scope, sourceId: saved.id })).events,
  ).toHaveLength(2);
});

test("pagination is deterministic for matching receipt instants and invalid cursors cannot widen scope", async () => {
  const saved = await source();
  for (let index = 0; index < 7; index++) {
    const raw = bytes(event("onboarding"));
    await service().ingest(saved.id, raw, signature(raw, saved.signingSecret));
  }
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await service().events(writer, {
      ...scope,
      sourceId: saved.id,
      limit: 2,
      cursor,
    });
    seen.push(...page.events.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toHaveLength(7);
  expect(new Set(seen).size).toBe(7);
  await expect(
    service().events(writer, { ...scope, cursor: "bad-cursor" }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

test("all source associations remain reachable and versioned beyond 200 without any receipt events", async () => {
  const saved = await source();
  await db.insert(s.yoduBindings).values(
    Array.from({ length: 201 }, (_, index) => ({
      ...scope,
      sourceId: saved.id,
      externalSubjectId: `fictional-no-receipt-${String(index).padStart(3, "0")}`,
      relationshipId: demoId(300),
      createdBy: demoUser,
    })),
  );
  const seen: { id: string; version: number; externalSubjectId: string }[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await service().sources(writer, {
      ...scope,
      bindingsCursor: cursor,
    });
    expect(page.bindingsTruncated).toBe(!!page.nextBindingsCursor);
    seen.push(...page.bindings.filter((row) => row.sourceId === saved.id));
    cursor = page.nextBindingsCursor ?? undefined;
    pages++;
  } while (cursor);
  expect(pages).toBeGreaterThan(1);
  expect(seen).toHaveLength(201);
  expect(new Set(seen.map((row) => row.id)).size).toBe(201);
  const last = seen.find(
    (row) => row.externalSubjectId === "fictional-no-receipt-200",
  );
  expect(last).toBeDefined();
  if (!last) throw new Error("Missing fictional association");
  expect(
    await service().bindSubject(writer, {
      ...scope,
      sourceId: saved.id,
      externalSubjectId: last.externalSubjectId,
      relationshipId: demoId(304),
      expectedVersion: last.version,
    }),
  ).toMatchObject({ version: 2 });
  await expect(
    service().sources(writer, { ...scope, bindingsCursor: "invalid-cursor" }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(
    (await service().events(writer, { ...scope, sourceId: saved.id })).events,
  ).toEqual([]);
});

test("business operations expose equivalent schemas to HTTP/MCP but never expose a verified event writer", async () => {
  const names = [
    "get_yodu_sources",
    "create_yodu_source",
    "update_yodu_source",
    "bind_yodu_subject",
    "list_yodu_events",
  ];
  expect(
    operations
      .filter((item) => item.name.includes("yodu"))
      .map((item) => item.name),
  ).toEqual(names);
  for (const name of names) {
    const operation = operations.find((item) => item.name === name);
    if (!operation) throw new Error("Missing operation");
    expect(
      apiOperation("integrations", operation.method, operation.operation),
    ).toBe(operation);
    expect(operationInput(operation).shape).not.toHaveProperty(
      "organizationId",
    );
  }
  for (const name of [
    "create_yodu_source",
    "update_yodu_source",
    "bind_yodu_subject",
  ]) {
    const operation = operations.find((item) => item.name === name);
    if (!operation) throw new Error("Missing operation");
    expect(operationRequirements(operation).administrator).toBe(true);
  }
  const read = apiOperation("integrations", "GET", "yodu-sources");
  expect(await read.execute({ db, principal: writer }, scope)).toHaveProperty(
    "sources",
  );
});

test("signed HTTP ingress rejects demo, unknown sources, missing/bad signatures and oversized or malformed bodies", async () => {
  const saved = await source();
  const valid = bytes({ ...event(), occurredAt: new Date().toISOString() });
  const call = (raw: Uint8Array, header: string | null, sourceId = saved.id) =>
    webhook(
      new Request(
        `https://gravity.example.test/api/webhooks/yodu?sourceId=${sourceId}`,
        {
          method: "POST",
          headers: header
            ? { "yodu-signature": header, "Content-Type": "application/json" }
            : {},
          body: Uint8Array.from(raw).buffer,
        },
      ),
    );
  expect(
    (await call(valid, signature(valid, saved.signingSecret, Date.now())))
      .status,
  ).toBe(200);
  expect((await call(valid, null)).status).toBe(401);
  expect(
    (
      await call(
        valid,
        signature(valid, "incorrect-fictional-secret", Date.now()),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await call(
        valid,
        signature(valid, saved.signingSecret, Date.now()),
        randomUUID(),
      )
    ).status,
  ).toBe(401);
  const malformed = new TextEncoder().encode("{");
  expect(
    (
      await call(
        malformed,
        signature(malformed, saved.signingSecret, Date.now()),
      )
    ).status,
  ).toBe(400);
  const invalidUtf8 = new Uint8Array([0xff]);
  expect(
    (
      await call(
        invalidUtf8,
        signature(invalidUtf8, saved.signingSecret, Date.now()),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        valid,
        signature(valid, saved.signingSecret, Date.now()),
        "invalid-source-id",
      )
    ).status,
  ).toBe(400);
  expect((await call(new Uint8Array(10001), "bad")).status).toBe(413);
  demo = true;
  expect(
    (await call(valid, signature(valid, saved.signingSecret, Date.now())))
      .status,
  ).toBe(503);
});
