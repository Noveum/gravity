import { and, asc, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  operationAvailable,
  operationRequirements,
  operations,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const org = demoId(1);
const platform = demoId(10);
const salesPipeline = demoId(1210);
const discovery = demoId(800);
const evaluation = demoId(801);
const proposal = demoId(802);
const won = demoId(803);
const lost = demoId(804);
const outreachNew = demoId(1200);
const outreachNotNow = demoId(1208);
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
) {
  return (await find(name).execute(
    { db: local.db, principal },
    { organizationId: org, ...input },
  )) as T;
}
async function stage(id: string) {
  const [row] = await local.db
    .select()
    .from(s.stages)
    .where(eq(s.stages.id, id));
  if (!row) throw new Error("stage fixture");
  return row;
}
async function dealStages() {
  return local.db
    .select()
    .from(s.stages)
    .where(
      and(eq(s.stages.pipelineId, salesPipeline), isNull(s.stages.archivedAt)),
    )
    .orderBy(asc(s.stages.position));
}
async function deal(id: string) {
  const [row] = await local.db
    .select()
    .from(s.opportunities)
    .where(eq(s.opportunities.id, id));
  if (!row) throw new Error("deal fixture");
  return row;
}
async function outreachRelationship() {
  const [row] = await local.db
    .select()
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.productId, platform),
        eq(s.relationships.stageId, demoId(1203)),
      ),
    )
    .limit(1);
  if (!row) throw new Error("relationship fixture");
  return row;
}

describe("create_stage", () => {
  test("appends a deal stage to the named pipeline", async () => {
    const created = await run<{ id: string }>("create_stage", admin, {
      productId: platform,
      pipeline: "deal",
      pipelineId: salesPipeline,
      name: "Negotiation",
    });
    expect(created).toMatchObject({
      name: "Negotiation",
      category: "open",
      pipeline: "deal",
      pipelineId: salesPipeline,
      position: 5,
    });
    expect((await dealStages()).map((row) => row.name)).toContain(
      "Negotiation",
    );
  });

  test("appends an outreach stage to the product's outreach pipeline", async () => {
    const created = await run("create_stage", admin, {
      productId: platform,
      pipeline: "outreach",
      name: "Nurture",
      category: "hold",
    });
    expect(created).toMatchObject({
      pipeline: "outreach",
      pipelineId: null,
      category: "hold",
      position: 9,
    });
  });

  test("refuses a missing deal pipeline, a hold deal stage and a duplicate name", async () => {
    await expect(
      run("create_stage", admin, {
        productId: platform,
        pipeline: "deal",
        name: "Orphan",
      }),
    ).rejects.toThrow();
    await expect(
      run("create_stage", admin, {
        productId: platform,
        pipeline: "deal",
        pipelineId: salesPipeline,
        name: "Parked",
        category: "hold",
      }),
    ).rejects.toMatchObject({ code: "STAGE_CATEGORY_INVALID" });
    await expect(
      run("create_stage", admin, {
        productId: platform,
        pipeline: "deal",
        pipelineId: salesPipeline,
        name: "discovery",
      }),
    ).rejects.toMatchObject({ code: "STAGE_EXISTS", status: 409 });
    await expect(
      run("create_stage", admin, {
        productId: platform,
        pipeline: "deal",
        pipelineId: demoId(1211),
        name: "Wrong product",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("update_stage", () => {
  test("renames a stage", async () => {
    await run("update_stage", admin, { stageId: proposal, name: "Offer" });
    expect((await stage(proposal)).name).toBe("Offer");
  });

  test("a deal stage category change moves its deals to the matching outcome", async () => {
    expect(await deal(demoId(1101))).toMatchObject({
      stageId: evaluation,
      status: "open",
    });
    const before = await deal(demoId(1101));
    await run("update_stage", admin, { stageId: evaluation, category: "won" });
    expect(await deal(demoId(1101))).toMatchObject({
      status: "won",
      probability: 100,
      version: before.version + 1,
    });
    expect((await deal(demoId(1101))).closedAt).toBeInstanceOf(Date);
    await run("update_stage", admin, { stageId: evaluation, category: "open" });
    expect(await deal(demoId(1101))).toMatchObject({
      status: "open",
      closedAt: null,
    });
  });

  test("each pipeline keeps at least one open stage", async () => {
    await run("update_stage", admin, { stageId: discovery, category: "lost" });
    await run("update_stage", admin, { stageId: evaluation, category: "lost" });
    await expect(
      run("update_stage", admin, { stageId: proposal, category: "won" }),
    ).rejects.toMatchObject({ code: "LAST_OPEN_STAGE", status: 409 });
    expect((await stage(proposal)).category).toBe("open");
  });

  test("a deal stage cannot become a hold stage", async () => {
    await expect(
      run("update_stage", admin, { stageId: proposal, category: "hold" }),
    ).rejects.toMatchObject({ code: "STAGE_CATEGORY_INVALID" });
  });
});

describe("reorder_stages", () => {
  test("writes the given order in one step", async () => {
    const order = [won, discovery, proposal, evaluation, lost];
    await run("reorder_stages", admin, {
      productId: platform,
      pipeline: "deal",
      pipelineId: salesPipeline,
      stageIds: order,
    });
    expect((await dealStages()).map((row) => row.id)).toEqual(order);
  });

  test("needs exactly the pipeline's active stages", async () => {
    for (const stageIds of [
      [won, discovery, proposal, evaluation],
      [won, discovery, proposal, evaluation, lost, outreachNew],
      [won, won, proposal, evaluation, lost],
    ])
      await expect(
        run("reorder_stages", admin, {
          productId: platform,
          pipeline: "deal",
          pipelineId: salesPipeline,
          stageIds,
        }),
      ).rejects.toThrow();
    expect((await dealStages()).map((row) => row.id)).toEqual([
      discovery,
      evaluation,
      proposal,
      won,
      lost,
    ]);
  });
});

test("new relationships start in the first open outreach stage after a reorder", async () => {
  const outreach = await local.db
    .select()
    .from(s.stages)
    .where(
      and(eq(s.stages.productId, platform), eq(s.stages.pipeline, "outreach")),
    )
    .orderBy(asc(s.stages.position));
  const order = [
    outreachNotNow,
    ...outreach.map((row) => row.id).filter((id) => id !== outreachNotNow),
  ];
  await run("reorder_stages", admin, {
    productId: platform,
    pipeline: "outreach",
    stageIds: order,
  });
  const created = await run<{ relationshipId: string }>(
    "create_person",
    admin,
    {
      productId: platform,
      name: "Fixture Prospect",
    },
  );
  const [relationship] = await local.db
    .select()
    .from(s.relationships)
    .where(eq(s.relationships.id, created.relationshipId));
  expect(relationship?.stageId).toBe(outreachNew);
});

describe("archive_stage", () => {
  test("moves the deals in a deal stage to the target in the same step", async () => {
    const result = await run("archive_stage", admin, {
      stageId: evaluation,
      moveToStageId: won,
    });
    expect(result).toMatchObject({ id: evaluation, moved: 1 });
    expect((await stage(evaluation)).archivedAt).toBeInstanceOf(Date);
    expect(await deal(demoId(1101))).toMatchObject({
      stageId: won,
      status: "won",
      probability: 100,
    });
  });

  test("moves outreach relationships and material links to the target", async () => {
    const relationship = await outreachRelationship();
    const source = relationship.stageId;
    if (!source) throw new Error("staged relationship fixture");
    const [asset] = await local.db
      .insert(s.assets)
      .values({
        organizationId: org,
        productId: platform,
        folderId: demoId(900),
        name: "fixture.md",
        storageKey: "fixture/fixture.md",
        mimeType: "text/markdown",
        size: 10,
        sha256: "0".repeat(64),
        uploadedBy: demoUser,
      })
      .returning();
    if (!asset) throw new Error("asset fixture");
    const target = outreachNotNow;
    await local.db.insert(s.assetStages).values([
      {
        organizationId: org,
        productId: platform,
        assetId: asset.id,
        stageId: source,
      },
      {
        organizationId: org,
        productId: platform,
        assetId: asset.id,
        stageId: target,
      },
    ]);
    const [second] = await local.db
      .insert(s.assets)
      .values({
        organizationId: org,
        productId: platform,
        folderId: demoId(900),
        name: "second.md",
        storageKey: "fixture/second.md",
        mimeType: "text/markdown",
        size: 10,
        sha256: "1".repeat(64),
        uploadedBy: demoUser,
      })
      .returning();
    if (!second) throw new Error("asset fixture");
    await local.db.insert(s.assetStages).values({
      organizationId: org,
      productId: platform,
      assetId: second.id,
      stageId: source,
    });
    const inSource = await local.db
      .select()
      .from(s.relationships)
      .where(eq(s.relationships.stageId, source));
    const result = await run("archive_stage", admin, {
      stageId: source,
      moveToStageId: target,
    });
    expect(result).toMatchObject({ moved: inSource.length });
    const moved = await local.db
      .select()
      .from(s.relationships)
      .where(eq(s.relationships.id, relationship.id));
    expect(moved[0]).toMatchObject({
      stageId: target,
      version: relationship.version + 1,
    });
    expect(
      await local.db
        .select()
        .from(s.relationships)
        .where(eq(s.relationships.stageId, source)),
    ).toEqual([]);
    for (const assetId of [asset.id, second.id]) {
      const links = await local.db
        .select()
        .from(s.assetStages)
        .where(eq(s.assetStages.assetId, assetId));
      expect(links.map((link) => link.stageId)).toEqual([target]);
    }
  });

  test("refuses a target in another pipeline, an archived target or itself", async () => {
    await expect(
      run("archive_stage", admin, {
        stageId: evaluation,
        moveToStageId: outreachNew,
      }),
    ).rejects.toMatchObject({ code: "STAGE_TARGET_INVALID" });
    await expect(
      run("archive_stage", admin, {
        stageId: evaluation,
        moveToStageId: evaluation,
      }),
    ).rejects.toMatchObject({ code: "STAGE_TARGET_INVALID" });
    await run("archive_stage", admin, {
      stageId: proposal,
      moveToStageId: discovery,
    });
    await expect(
      run("archive_stage", admin, {
        stageId: evaluation,
        moveToStageId: proposal,
      }),
    ).rejects.toMatchObject({ code: "STAGE_TARGET_INVALID" });
    expect((await deal(demoId(1101))).stageId).toBe(evaluation);
  });

  test("the last open stage cannot be archived", async () => {
    await run("archive_stage", admin, {
      stageId: discovery,
      moveToStageId: proposal,
    });
    await run("archive_stage", admin, {
      stageId: evaluation,
      moveToStageId: proposal,
    });
    await expect(
      run("archive_stage", admin, { stageId: proposal, moveToStageId: won }),
    ).rejects.toMatchObject({ code: "LAST_OPEN_STAGE" });
    expect((await stage(proposal)).archivedAt).toBeNull();
  });

  test("archived stages no longer accept deals", async () => {
    await run("archive_stage", admin, {
      stageId: proposal,
      moveToStageId: discovery,
    });
    const current = await deal(demoId(1101));
    await expect(
      run("save_deal", admin, {
        id: current.id,
        version: current.version,
        productId: platform,
        relationshipId: current.relationshipId,
        stageId: proposal,
        name: current.name,
        ownerId: demoUser,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("update_pipeline", () => {
  test("renames a deal pipeline and refuses a duplicate name", async () => {
    await run("create_pipeline", admin, {
      productId: platform,
      name: "Partnerships",
    });
    await expect(
      run("update_pipeline", admin, {
        pipelineId: salesPipeline,
        name: "Partnerships",
      }),
    ).rejects.toMatchObject({ code: "PIPELINE_EXISTS", status: 409 });
    const renamed = await run("update_pipeline", admin, {
      pipelineId: salesPipeline,
      name: "New business",
    });
    expect(renamed).toMatchObject({ id: salesPipeline, name: "New business" });
  });
});

test("stage and pipeline operations need an administrator with access to the product", async () => {
  const attempts: [string, Record<string, unknown>][] = [
    [
      "create_stage",
      {
        productId: platform,
        pipeline: "deal",
        pipelineId: salesPipeline,
        name: "Member stage",
      },
    ],
    ["update_stage", { stageId: proposal, name: "Member rename" }],
    [
      "reorder_stages",
      {
        productId: platform,
        pipeline: "deal",
        pipelineId: salesPipeline,
        stageIds: [lost, won, proposal, evaluation, discovery],
      },
    ],
    ["archive_stage", { stageId: proposal, moveToStageId: discovery }],
    ["update_pipeline", { pipelineId: salesPipeline, name: "Member rename" }],
  ];
  for (const [name, input] of attempts) {
    for (const principal of [teammate, { ...agent, productIds: [demoId(11)] }])
      await expect(run(name, principal, input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    expect(operationRequirements(find(name))).toMatchObject({
      administrator: true,
      allProducts: false,
    });
    expect(operationAvailable(find(name), agent, "member")).toBe(false);
  }
  await expect(
    run(
      "update_stage",
      { ...agent, productIds: [platform] },
      {
        stageId: proposal,
        name: "Granted rename",
      },
    ),
  ).resolves.toMatchObject({ name: "Granted rename" });
});
