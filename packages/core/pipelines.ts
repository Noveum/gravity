import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import {
  authorize,
  DomainError,
  type Principal,
  uniqueViolation,
} from "./policy";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Stage = typeof s.stages.$inferSelect;
type StageCategory = Stage["category"];

const stageName = z.string().trim().min(1).max(100);
const stageCategory = z.enum(["open", "won", "lost", "hold"]);
const pipelineKind = z.enum(["deal", "outreach"]);
const scope = z.object({ organizationId: z.uuid() });
const namedPipeline = (value: {
  pipeline: "deal" | "outreach";
  pipelineId?: string | undefined;
}) => (value.pipeline === "deal") === (value.pipelineId !== undefined);

export const createStageSchema = scope
  .extend({
    productId: z.uuid(),
    pipeline: pipelineKind,
    pipelineId: z.uuid().optional(),
    name: stageName,
    category: stageCategory.default("open"),
  })
  .refine(namedPipeline);
export const updateStageSchema = scope
  .extend({
    productId: z.uuid().optional(),
    stageId: z.uuid(),
    name: stageName.optional(),
    category: stageCategory.optional(),
  })
  .refine((value) => value.name !== undefined || value.category !== undefined);
export const reorderStagesSchema = scope
  .extend({
    productId: z.uuid(),
    pipeline: pipelineKind,
    pipelineId: z.uuid().optional(),
    stageIds: z
      .array(z.uuid())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .refine(namedPipeline);
export const archiveStageSchema = scope.extend({
  productId: z.uuid().optional(),
  stageId: z.uuid(),
  moveToStageId: z.uuid(),
});
export const updatePipelineSchema = scope.extend({
  productId: z.uuid().optional(),
  pipelineId: z.uuid(),
  name: stageName,
});

interface StageGroup {
  organizationId: string;
  productId: string;
  pipeline: "deal" | "outreach";
  pipelineId: string | null;
}

async function authorizeProductAdministrator(
  tx: Transaction,
  principal: Principal,
  organizationId: string,
  productId: string,
) {
  const { membership } = await authorize(
    tx,
    principal,
    organizationId,
    productId,
    true,
  );
  if (membership.role !== "admin") throw new DomainError("FORBIDDEN", 403);
}
function lockGroup(tx: Transaction, group: StageGroup) {
  return tx
    .select()
    .from(s.stages)
    .where(
      and(
        eq(s.stages.organizationId, group.organizationId),
        eq(s.stages.productId, group.productId),
        eq(s.stages.pipeline, group.pipeline),
        group.pipelineId
          ? eq(s.stages.pipelineId, group.pipelineId)
          : isNull(s.stages.pipelineId),
      ),
    )
    .for("update");
}
async function findStage(
  tx: Transaction,
  principal: Principal,
  input: { organizationId: string; productId?: string; stageId: string },
) {
  const [found] = await tx
    .select()
    .from(s.stages)
    .where(
      and(
        eq(s.stages.id, input.stageId),
        eq(s.stages.organizationId, input.organizationId),
      ),
    );
  if (!found) throw new DomainError("NOT_FOUND", 404);
  await authorizeProductAdministrator(
    tx,
    principal,
    input.organizationId,
    found.productId,
  );
  if (input.productId && input.productId !== found.productId)
    throw new DomainError("FORBIDDEN", 403);
  const group = await lockGroup(tx, found);
  const stage = group.find((row) => row.id === found.id);
  if (!stage) throw new DomainError("NOT_FOUND", 404);
  if (stage.archivedAt) throw new DomainError("RECORD_ARCHIVED", 409);
  return { stage, active: group.filter((row) => !row.archivedAt) };
}
function assertCategory(pipeline: Stage["pipeline"], category: StageCategory) {
  if (pipeline === "deal" && category === "hold")
    throw new DomainError("STAGE_CATEGORY_INVALID", 400);
}
function assertUniqueName(active: Stage[], name: string, except?: string) {
  const key = name.toLocaleLowerCase();
  if (
    active.some(
      (row) => row.id !== except && row.name.toLocaleLowerCase() === key,
    )
  )
    throw new DomainError("STAGE_EXISTS", 409);
}
function assertAnotherOpenStage(active: Stage[], stage: Stage) {
  if (
    stage.category === "open" &&
    !active.some((row) => row.id !== stage.id && row.category === "open")
  )
    throw new DomainError("LAST_OPEN_STAGE", 409);
}
async function moveDeals(
  tx: Transaction,
  actorId: string,
  from: Stage,
  to: Stage,
) {
  const deals = await tx
    .select()
    .from(s.opportunities)
    .where(
      and(
        eq(s.opportunities.organizationId, from.organizationId),
        eq(s.opportunities.stageId, from.id),
      ),
    )
    .for("update");
  const status = to.category === "hold" ? "open" : to.category;
  const now = new Date();
  for (const deal of deals)
    await tx
      .update(s.opportunities)
      .set({
        stageId: to.id,
        status,
        probability:
          status === "won" ? 100 : status === "lost" ? 0 : deal.probability,
        closedAt:
          status === "open"
            ? null
            : deal.status === status
              ? (deal.closedAt ?? now)
              : now,
        updatedAt: now,
        version: deal.version + 1,
      })
      .where(eq(s.opportunities.id, deal.id));
  if (deals.length)
    await tx.insert(s.changeEvents).values(
      deals.map((deal) => ({
        organizationId: from.organizationId,
        productId: from.productId,
        actorId,
        type: "opportunity.updated",
        entityId: deal.id,
      })),
    );
  return deals.length;
}
async function moveRelationships(
  tx: Transaction,
  actorId: string,
  from: Stage,
  to: Stage,
) {
  const moved = await tx
    .update(s.relationships)
    .set({ stageId: to.id, version: sql`${s.relationships.version} + 1` })
    .where(
      and(
        eq(s.relationships.organizationId, from.organizationId),
        eq(s.relationships.stageId, from.id),
      ),
    )
    .returning({ id: s.relationships.id });
  if (moved.length)
    await tx.insert(s.changeEvents).values(
      moved.map((relationship) => ({
        organizationId: from.organizationId,
        productId: from.productId,
        actorId,
        type: "relationship.stage_moved",
        entityId: relationship.id,
      })),
    );
  return moved.length;
}
async function moveMaterialLinks(tx: Transaction, from: Stage, to: Stage) {
  const links = await tx
    .select()
    .from(s.assetStages)
    .where(
      and(
        eq(s.assetStages.organizationId, from.organizationId),
        eq(s.assetStages.stageId, from.id),
      ),
    );
  if (!links.length) return;
  await tx
    .insert(s.assetStages)
    .values(links.map((link) => ({ ...link, stageId: to.id })))
    .onConflictDoNothing();
  await tx.delete(s.assetStages).where(
    and(
      eq(s.assetStages.organizationId, from.organizationId),
      eq(s.assetStages.stageId, from.id),
      inArray(
        s.assetStages.assetId,
        links.map((link) => link.assetId),
      ),
    ),
  );
}

export class PipelineService {
  constructor(private db: Database) {}

  async createStage(
    principal: Principal,
    input: z.infer<typeof createStageSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizeProductAdministrator(
        tx,
        principal,
        input.organizationId,
        input.productId,
      );
      assertCategory(input.pipeline, input.category);
      const [parent] = input.pipelineId
        ? await tx
            .select({ id: s.pipelines.id })
            .from(s.pipelines)
            .where(
              and(
                eq(s.pipelines.id, input.pipelineId),
                eq(s.pipelines.organizationId, input.organizationId),
                eq(s.pipelines.productId, input.productId),
              ),
            )
            .for("update")
        : await tx
            .select({ id: s.products.id })
            .from(s.products)
            .where(
              and(
                eq(s.products.id, input.productId),
                eq(s.products.organizationId, input.organizationId),
              ),
            )
            .for("update");
      if (!parent) throw new DomainError("NOT_FOUND", 404);
      const group = await lockGroup(tx, {
        organizationId: input.organizationId,
        productId: input.productId,
        pipeline: input.pipeline,
        pipelineId: input.pipelineId ?? null,
      });
      assertUniqueName(
        group.filter((row) => !row.archivedAt),
        input.name,
      );
      const [stage] = await tx
        .insert(s.stages)
        .values({
          organizationId: input.organizationId,
          productId: input.productId,
          pipeline: input.pipeline,
          pipelineId: input.pipelineId ?? null,
          name: input.name,
          category: input.category,
          position: Math.max(-1, ...group.map((row) => row.position)) + 1,
        })
        .returning();
      if (!stage) throw new DomainError("NOT_FOUND", 404);
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: input.productId,
        actorId: principal.userId,
        type: "stage.created",
        entityId: stage.id,
      });
      return stage;
    });
  }

  async updateStage(
    principal: Principal,
    input: z.infer<typeof updateStageSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const { stage, active } = await findStage(tx, principal, input);
      if (input.name !== undefined)
        assertUniqueName(active, input.name, stage.id);
      const recategorized =
        input.category !== undefined && input.category !== stage.category;
      if (input.category !== undefined && recategorized) {
        assertCategory(stage.pipeline, input.category);
        assertAnotherOpenStage(active, stage);
      }
      const [updated] = await tx
        .update(s.stages)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
        })
        .where(eq(s.stages.id, stage.id))
        .returning();
      if (!updated) throw new DomainError("NOT_FOUND", 404);
      if (recategorized && stage.pipeline === "deal")
        await moveDeals(tx, principal.userId, stage, updated);
      await tx.insert(s.changeEvents).values({
        organizationId: stage.organizationId,
        productId: stage.productId,
        actorId: principal.userId,
        type: "stage.updated",
        entityId: stage.id,
      });
      return updated;
    });
  }

  async reorderStages(
    principal: Principal,
    input: z.infer<typeof reorderStagesSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      await authorizeProductAdministrator(
        tx,
        principal,
        input.organizationId,
        input.productId,
      );
      const group = await lockGroup(tx, {
        organizationId: input.organizationId,
        productId: input.productId,
        pipeline: input.pipeline,
        pipelineId: input.pipelineId ?? null,
      });
      const active = new Set(
        group.filter((row) => !row.archivedAt).map((row) => row.id),
      );
      if (
        active.size !== input.stageIds.length ||
        input.stageIds.some((id) => !active.has(id))
      )
        throw new DomainError("STAGE_ORDER_INVALID", 400);
      for (const [position, id] of input.stageIds.entries())
        await tx.update(s.stages).set({ position }).where(eq(s.stages.id, id));
      await tx.insert(s.changeEvents).values({
        organizationId: input.organizationId,
        productId: input.productId,
        actorId: principal.userId,
        type: "stage.reordered",
        entityId: input.pipelineId ?? input.productId,
      });
      return { stageIds: input.stageIds };
    });
  }

  async archiveStage(
    principal: Principal,
    input: z.infer<typeof archiveStageSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const { stage, active } = await findStage(tx, principal, input);
      const target = active.find(
        (row) => row.id === input.moveToStageId && row.id !== stage.id,
      );
      if (!target) throw new DomainError("STAGE_TARGET_INVALID", 400);
      assertAnotherOpenStage(active, stage);
      const moved =
        stage.pipeline === "deal"
          ? await moveDeals(tx, principal.userId, stage, target)
          : await moveRelationships(tx, principal.userId, stage, target);
      await moveMaterialLinks(tx, stage, target);
      const [archived] = await tx
        .update(s.stages)
        .set({ archivedAt: new Date() })
        .where(eq(s.stages.id, stage.id))
        .returning();
      if (!archived) throw new DomainError("NOT_FOUND", 404);
      await tx.insert(s.changeEvents).values({
        organizationId: stage.organizationId,
        productId: stage.productId,
        actorId: principal.userId,
        type: "stage.archived",
        entityId: stage.id,
      });
      return { ...archived, movedToStageId: target.id, moved };
    });
  }

  async updatePipeline(
    principal: Principal,
    input: z.infer<typeof updatePipelineSchema>,
  ) {
    return this.db
      .transaction(async (tx) => {
        const [found] = await tx
          .select()
          .from(s.pipelines)
          .where(
            and(
              eq(s.pipelines.id, input.pipelineId),
              eq(s.pipelines.organizationId, input.organizationId),
            ),
          );
        if (!found) throw new DomainError("NOT_FOUND", 404);
        await authorizeProductAdministrator(
          tx,
          principal,
          input.organizationId,
          found.productId,
        );
        if (input.productId && input.productId !== found.productId)
          throw new DomainError("FORBIDDEN", 403);
        const [pipeline] = await tx
          .update(s.pipelines)
          .set({ name: input.name })
          .where(eq(s.pipelines.id, found.id))
          .returning();
        if (!pipeline) throw new DomainError("NOT_FOUND", 404);
        await tx.insert(s.changeEvents).values({
          organizationId: input.organizationId,
          productId: found.productId,
          actorId: principal.userId,
          type: "pipeline.updated",
          entityId: found.id,
        });
        return pipeline;
      })
      .catch((error: unknown) => {
        if (uniqueViolation(error))
          throw new DomainError("PIPELINE_EXISTS", 409);
        throw error;
      });
  }
}
