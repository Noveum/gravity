import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  dateKey,
  money,
  overview,
  parseMoney,
  totals,
} from "../packages/core/analytics";
import {
  CrmService,
  messageActivitySchema,
  opportunitySchema,
  pipelineSchema,
} from "../packages/core/crm";
import { serialize } from "../packages/core/dto";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { mcpHandler } from "../packages/mcp/server";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let service: CrmService;
const admin = { userId: demoUser, source: "session" as const };
const teammate = { userId: "demo-teammate", source: "session" as const };
const restricted = { userId: "demo-restricted", source: "session" as const };
const org = demoId(1);
const dealInput = (extra: Record<string, unknown> = {}) =>
  opportunitySchema.parse({
    organizationId: org,
    productId: demoId(10),
    relationshipId: demoId(300),
    stageId: demoId(800),
    name: "Fictional evaluation",
    ownerId: demoUser,
    amountMinor: 125000,
    currency: "USD",
    probability: 40,
    ...extra,
  });
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  service = new CrmService(local.db);
});
afterAll(async () => {
  await local.client.close();
});

test("money respects currency precision and keeps unknown amounts out of totals", async () => {
  expect(parseMoney("12.34", "USD")).toBe(1234);
  expect(parseMoney("12", "JPY")).toBe(12);
  expect(parseMoney("12.345", "KWD")).toBe(12345);
  expect(parseMoney("", "USD")).toBeNull();
  for (const input of ["-1", "1e3", "0.001", "99999999999", "NaN"])
    expect(() => parseMoney(input, "USD")).toThrow();
  expect(() => parseMoney("12.1", "JPY")).toThrow();
  expect(money(1200, "JPY")).toContain("1,200");
  const snapshot = serialize(
    await service.snapshot(admin, { organizationId: org }),
  );
  const first = snapshot.opportunities[0];
  expect(
    totals([
      { ...first, amountMinor: 10000, currency: "USD", probability: 50 },
      { ...first, amountMinor: 5000, currency: "EUR", probability: null },
      { ...first, amountMinor: null, currency: "USD", probability: 100 },
    ]),
  ).toEqual([
    { currency: "EUR", amountMinor: 5000, count: 1 },
    { currency: "USD", amountMinor: 10000, count: 1 },
  ]);
  expect(
    totals([{ ...first, amountMinor: 5000, probability: null }], true),
  ).toEqual([]);
});

test("reports use organization days, actual outcomes, and synced messages rather than drafts", async () => {
  const snapshot = serialize(
    await service.snapshot(admin, { organizationId: org }),
  );
  const now = new Date("2026-10-05T00:30:00Z");
  expect(dateKey(now, "America/Los_Angeles")).toBe("2026-10-04");
  const first = snapshot.opportunities[0];
  const baseAction = snapshot.actions[0];
  snapshot.opportunities = [
    {
      ...first,
      id: "open",
      status: "open",
      probability: null,
      amountMinor: null,
    },
    { ...first, id: "won", status: "won", closedAt: "2026-10-04T23:00:00Z" },
    { ...first, id: "lost", status: "lost", closedAt: "2026-10-02T23:00:00Z" },
    { ...first, id: "legacy", status: "won", closedAt: null },
    { ...first, id: "old", status: "won", closedAt: "2026-09-01T00:00:00Z" },
  ];
  snapshot.actions = [
    {
      ...baseAction,
      id: "due",
      dueAt: "2026-10-05T01:00:00Z",
      status: "open",
      owedBy: "us",
    },
    {
      ...baseAction,
      id: "late",
      dueAt: "2026-10-03T01:00:00Z",
      status: "open",
      owedBy: "us",
    },
    {
      ...baseAction,
      id: "them",
      dueAt: "2026-10-01T01:00:00Z",
      status: "open",
      owedBy: "them",
    },
    {
      ...baseAction,
      id: "done",
      dueAt: "2026-10-01T01:00:00Z",
      status: "completed",
      owedBy: "us",
    },
  ];
  snapshot.messageStats = [
    {
      day: "2026-10-04",
      ownerId: demoUser,
      productId: demoId(10),
      channel: "gmail",
      inbound: 2,
      outbound: 3,
    },
    {
      day: "2026-10-04",
      ownerId: "demo-teammate",
      productId: demoId(10),
      channel: "linkedin",
      inbound: 5,
      outbound: 6,
    },
    {
      day: "2026-10-05",
      ownerId: demoUser,
      productId: demoId(10),
      channel: "gmail",
      inbound: 99,
      outbound: 99,
    },
  ];
  const report = overview(snapshot, {
    days: 7,
    timeZone: "America/Los_Angeles",
    now,
  });
  expect(report.from).toBe("2026-09-28");
  expect(report.overdue.map((a) => a.id)).toEqual(["late"]);
  expect(report.dueToday.map((a) => a.id)).toEqual(["due"]);
  expect(report.waiting.map((a) => a.id)).toEqual(["them"]);
  expect(report.closed.map((d) => d.id)).toEqual(["won", "lost"]);
  expect(report.winRate).toBe(50);
  expect(report.sent).toBe(9);
  expect(report.received).toBe(7);
  expect(report.days).toHaveLength(7);
  expect(report.days.at(-1)?.outbound).toBe(9);
  expect(report.pipelineValue).toEqual([]);
  const own = overview(snapshot, {
    days: 7,
    timeZone: "America/Los_Angeles",
    now,
    ownerId: demoUser,
    channel: "gmail",
  });
  expect(own.sent).toBe(3);
  expect(own.received).toBe(2);
});

test("message totals and drill-through enforce private, product, and tenant visibility", async () => {
  const owner = await service.overview(admin, {
    organizationId: org,
    days: 30,
  });
  const other = await service.overview(teammate, {
    organizationId: org,
    days: 30,
  });
  expect(owner.sent).toBe(1);
  expect(owner.received).toBe(2);
  expect(other.received).toBe(1);
  const input = messageActivitySchema.parse({
    organizationId: org,
    from: owner.from,
    through: owner.through,
  });
  expect((await service.messageActivity(admin, input)).items).toHaveLength(3);
  const rows = (await service.messageActivity(teammate, input)).items;
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.channel === "gmail")).toBe(true);
  expect(
    (await service.overview(restricted, { organizationId: org, days: 30 }))
      .received,
  ).toBe(0);
  await expect(
    service.messageActivity(restricted, { ...input, productId: demoId(10) }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.overview(teammate, { organizationId: demoId(2), days: 30 }),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (await service.overview(admin, { organizationId: demoId(2), days: 30 }))
      .sent,
  ).toBe(0);
  await local.db.insert(s.messages).values({
    organizationId: org,
    productId: demoId(10),
    conversationId: demoId(710),
    connectionId: demoId(700),
    providerMessageId: randomUUID(),
    direction: "outbound",
    body: "Future fixture must not count",
    occurredAt: new Date(Date.now() + 86400000),
  });
  expect(
    (await service.overview(admin, { organizationId: org, days: 30 })).sent,
  ).toBe(1);
});

test("message pagination and local-day boundaries agree with overview", async () => {
  await local.db
    .update(s.organizations)
    .set({ timezone: "Asia/Kolkata" })
    .where(eq(s.organizations.id, org));
  const yesterday = new Date(Date.now() - 86400000);
  const day = dateKey(yesterday, "Asia/Kolkata");
  await local.db.insert(s.messages).values(
    Array.from({ length: 52 }, (_, i) => ({
      organizationId: org,
      productId: demoId(10),
      conversationId: demoId(710),
      connectionId: demoId(700),
      providerMessageId: randomUUID(),
      direction: "outbound" as const,
      body: "x".repeat(300),
      occurredAt: new Date(yesterday.getTime() - i),
    })),
  );
  const input = messageActivitySchema.parse({
    organizationId: org,
    from: day,
    through: day,
    direction: "outbound",
  });
  const a = await service.messageActivity(admin, input);
  const b = await service.messageActivity(admin, { ...input, page: 1 });
  expect(a.items).toHaveLength(50);
  expect(a.hasMore).toBe(true);
  expect(b.items).toHaveLength(2);
  expect(b.hasMore).toBe(false);
  expect(new Set([...a.items, ...b.items].map((r) => r.id)).size).toBe(52);
  expect(a.items[0].preview).toHaveLength(200);
  const report = await service.overview(admin, {
    organizationId: org,
    days: 7,
  });
  expect(report.days.find((d) => d.day === day)?.outbound).toBe(52);
});

test("deal writes validate ownership and scope, record outcomes, and reject stale updates", async () => {
  for (const extra of [
    { stageId: demoId(820) },
    { relationshipId: demoId(302) },
    { ownerId: restricted.userId },
    { productId: demoId(13) },
  ])
    await expect(
      service.saveOpportunity(admin, dealInput(extra)),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.saveOpportunity(restricted, dealInput()),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.saveOpportunity(
      { ...admin, source: "mcp", readOnly: true, organizationId: org },
      dealInput(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  const saved = await service.saveOpportunity(admin, dealInput());
  expect(saved.version).toBe(1);
  expect(saved.closedAt).toBeNull();
  expect(saved.createdAt).toBeInstanceOf(Date);
  const won = await service.saveOpportunity(
    admin,
    dealInput({
      id: saved.id,
      version: 1,
      stageId: demoId(803),
      status: "won",
    }),
  );
  expect(won.probability).toBe(100);
  expect(won.closedAt).toBeInstanceOf(Date);
  await expect(
    service.saveOpportunity(admin, dealInput({ id: saved.id, version: 1 })),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const edit = await service.saveOpportunity(
    admin,
    dealInput({
      id: saved.id,
      version: 2,
      stageId: demoId(803),
      status: "won",
      amountMinor: 250000,
    }),
  );
  expect(edit.closedAt?.getTime()).toBe(won.closedAt?.getTime());
  const reopened = await service.saveOpportunity(
    admin,
    dealInput({ id: saved.id, version: 3 }),
  );
  expect(reopened.closedAt).toBeNull();
  await expect(
    service.saveOpportunity(admin, dealInput({ status: "won" })),
  ).rejects.toMatchObject({ code: "DEAL_STAGE_OUTCOME" });
  expect(
    opportunitySchema.safeParse({ ...dealInput(), id: saved.id }).success,
  ).toBe(false);
  for (const extra of [
    { amountMinor: -1 },
    { probability: 101 },
    { currency: "ZZZ" },
    { expectedCloseDate: "bad" },
  ])
    expect(
      opportunitySchema.safeParse({ ...dealInput(), ...extra }).success,
    ).toBe(false);
});

test("multiple pipelines stay product-bound and only admins can create them", async () => {
  const input = pipelineSchema.parse({
    organizationId: org,
    productId: demoId(10),
    name: "Enterprise",
  });
  await expect(service.createPipeline(teammate, input)).rejects.toMatchObject({
    status: 403,
  });
  const created = await service.createPipeline(admin, input);
  await expect(service.createPipeline(admin, input)).rejects.toMatchObject({
    code: "PIPELINE_EXISTS",
  });
  const stages = await local.db
    .select()
    .from(s.stages)
    .where(eq(s.stages.pipelineId, created.id));
  expect(stages).toHaveLength(5);
  expect(stages.map((stage) => stage.kind)).toEqual([
    "open",
    "open",
    "open",
    "won",
    "lost",
  ]);
  await expect(
    local.db.insert(s.stages).values({
      organizationId: org,
      productId: demoId(12),
      pipelineId: created.id,
      name: "Cross-product",
      position: 0,
    }),
  ).rejects.toThrow();
  const report = await service.snapshot(restricted, { organizationId: org });
  expect(report.pipelines.every((p) => p.productId === demoId(11))).toBe(true);
});

test("MCP reports and deal writes use the same service and grant boundaries", async () => {
  const principal = {
    ...admin,
    source: "mcp" as const,
    readOnly: false,
    organizationId: org,
    productIds: [demoId(10)],
  };
  const call = async (name: string, args: object) => {
    const response = await mcpHandler(local.db, principal, org).fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const envelope = JSON.parse(
      (await response.text())
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6) ?? "{}",
    );
    return envelope.result;
  };
  const report = await call("get_overview", { days: 7 });
  expect(report.isError).not.toBe(true);
  const overviewReport = JSON.parse(report.content[0].text);
  expect(overviewReport.sent).toBe(53);
  expect(
    overviewReport.deals.every(
      (d: { productId: string }) => d.productId === demoId(10),
    ),
  ).toBe(true);
  const { organizationId: _org, ...input } = dealInput();
  const saved = await call("save_deal", input);
  expect(saved.isError).not.toBe(true);
  expect(JSON.parse(saved.content[0].text)).toMatchObject({
    name: input.name,
    amountMinor: 125000,
    probability: 40,
  });
  const denied = await call("save_deal", {
    ...input,
    productId: demoId(12),
    relationshipId: demoId(302),
    stageId: demoId(820),
  });
  expect(denied.isError).toBe(true);
  expect(denied.content[0].text).toContain("FORBIDDEN");
});
