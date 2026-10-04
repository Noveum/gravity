import { and, asc, count, db, eq, isNull, ne, schema } from '@gravity/db';
import { conflict, notFound, validationFailed } from '@gravity/shared/errors';
import type { Principal } from '@gravity/shared/policy';
import { assertCan } from '@gravity/shared/policy';
import type { StageRow } from '@gravity/shared/records';
import {
  stageCreateSchema,
  stageReorderSchema,
  stageUpdateSchema,
} from '@gravity/shared/validators';
import { newId, requireRow } from '../internal.ts';
import { livePipeline, liveStagesOf } from './lookups.ts';
import { stageRowOf } from './rows.ts';
import { pipelineScopes } from './scopes.ts';
import { type SyncBatch, type WithActions, withBatch } from './sync-batch.ts';
import type { WriteContext } from './write-context.ts';

async function lockedStage(batch: SyncBatch, stageId: string) {
  const live = and(
    eq(schema.stage.id, stageId),
    eq(schema.stage.organizationId, batch.organizationId),
    isNull(schema.stage.archivedAt),
  );
  const [located] = await batch.tx
    .select({ pipelineId: schema.stage.pipelineId })
    .from(schema.stage)
    .where(live)
    .limit(1);
  if (located === undefined) throw notFound('That stage does not exist.');
  const [pipeline] = await batch.tx
    .select({ brandId: schema.pipeline.brandId })
    .from(schema.pipeline)
    .where(and(eq(schema.pipeline.id, located.pipelineId), isNull(schema.pipeline.archivedAt)))
    .limit(1)
    .for('update');
  if (pipeline === undefined) throw notFound('That stage does not exist.');
  const [stage] = await batch.tx.select().from(schema.stage).where(live).limit(1).for('update');
  if (stage === undefined) throw notFound('That stage does not exist.');
  return { stage, brandId: pipeline.brandId };
}

async function leadsIn(batch: SyncBatch, stageId: string): Promise<number> {
  const [row] = await batch.tx
    .select({ total: count() })
    .from(schema.lead)
    .where(and(eq(schema.lead.stageId, stageId), isNull(schema.lead.archivedAt)));
  return row?.total ?? 0;
}

async function otherOpenStages(
  batch: SyncBatch,
  pipelineId: string,
  stageId: string,
): Promise<number> {
  const [row] = await batch.tx
    .select({ total: count() })
    .from(schema.stage)
    .where(
      and(
        eq(schema.stage.pipelineId, pipelineId),
        eq(schema.stage.category, 'open'),
        isNull(schema.stage.archivedAt),
        ne(schema.stage.id, stageId),
      ),
    );
  return row?.total ?? 0;
}

function leadCount(total: number): string {
  return total === 1 ? '1 lead' : `${total} leads`;
}

function emitStage(
  batch: SyncBatch,
  syncId: number,
  action: 'insert' | 'update' | 'archive' | 'unarchive',
  stage: StageRow,
  brandId: string,
): void {
  batch.emit({
    syncId,
    action,
    model: 'stage',
    modelId: stage.id,
    data: stage,
    scopes: pipelineScopes(batch.organizationId, brandId, stage.pipelineId),
  });
}

export async function createStage(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<{ stage: StageRow }>> {
  assertCan(context.principal, 'pipeline:manage');
  const parsed = stageCreateSchema.parse(input);
  return await withBatch(context, async (batch) => {
    const pipeline = await livePipeline(batch.tx, batch.organizationId, parsed.pipelineId, true);
    const existing = await liveStagesOf(batch.tx, batch.organizationId, [pipeline.id]);
    const sortOrder = existing.reduce((max, stage) => Math.max(max, stage.sortOrder + 1), 0);
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .insert(schema.stage)
      .values({
        id: newId(),
        organizationId: batch.organizationId,
        pipelineId: pipeline.id,
        name: parsed.name,
        category: parsed.category,
        sortOrder,
        syncId,
      })
      .returning();
    const stage = stageRowOf(requireRow(row, 'The stage could not be created.'));
    emitStage(batch, syncId, 'insert', stage, pipeline.brandId);
    return { stage };
  });
}

export async function updateStage(
  context: WriteContext,
  stageId: string,
  input: unknown,
): Promise<WithActions<{ stage: StageRow }>> {
  assertCan(context.principal, 'pipeline:manage');
  const parsed = stageUpdateSchema.parse(input);
  return await withBatch(context, async (batch) => {
    const current = await lockedStage(batch, stageId);
    const retyped = parsed.category !== undefined && parsed.category !== current.stage.category;
    if (retyped) {
      const total = await leadsIn(batch, stageId);
      if (total > 0) {
        throw conflict(
          `Move the ${leadCount(total)} in ${current.stage.name} to another stage before changing its type.`,
        );
      }
      if (
        current.stage.category === 'open' &&
        (await otherOpenStages(batch, current.stage.pipelineId, stageId)) === 0
      ) {
        throw conflict('A pipeline needs at least one open stage.');
      }
    }
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .update(schema.stage)
      .set({
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(parsed.category === undefined ? {} : { category: parsed.category }),
        syncId,
        updatedAt: new Date(),
      })
      .where(eq(schema.stage.id, stageId))
      .returning();
    const stage = stageRowOf(requireRow(row, 'That stage does not exist.'));
    if (retyped) {
      await batch.tx
        .update(schema.lead)
        .set({ stageCategory: stage.category, updatedAt: new Date() })
        .where(
          and(
            eq(schema.lead.stageId, stageId),
            eq(schema.lead.organizationId, batch.organizationId),
          ),
        );
    }
    emitStage(batch, syncId, 'update', stage, current.brandId);
    return { stage };
  });
}

export async function reorderStages(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<{ stages: StageRow[] }>> {
  assertCan(context.principal, 'pipeline:manage');
  const parsed = stageReorderSchema.parse(input);
  return await withBatch(context, async (batch) => {
    const pipeline = await livePipeline(batch.tx, batch.organizationId, parsed.pipelineId, true);
    const current = await liveStagesOf(batch.tx, batch.organizationId, [pipeline.id]);
    const known = new Set(current.map((stage) => stage.id));
    if (known.size !== parsed.stageIds.length || parsed.stageIds.some((id) => !known.has(id))) {
      throw validationFailed('Send every stage of the pipeline exactly once.');
    }
    const byId = new Map(current.map((stage) => [stage.id, stage]));
    const stages: StageRow[] = [];
    for (const [sortOrder, id] of parsed.stageIds.entries()) {
      const before = byId.get(id);
      if (before === undefined) continue;
      if (before.sortOrder === sortOrder) {
        stages.push(before);
        continue;
      }
      const syncId = await batch.nextSyncId();
      const [row] = await batch.tx
        .update(schema.stage)
        .set({ sortOrder, syncId, updatedAt: new Date() })
        .where(eq(schema.stage.id, id))
        .returning();
      const stage = stageRowOf(requireRow(row, 'That stage does not exist.'));
      stages.push(stage);
      emitStage(batch, syncId, 'update', stage, pipeline.brandId);
    }
    return { stages };
  });
}

export async function archiveStage(
  context: WriteContext,
  stageId: string,
): Promise<WithActions<{ stage: StageRow }>> {
  assertCan(context.principal, 'pipeline:manage');
  return await withBatch(context, async (batch) => {
    const current = await lockedStage(batch, stageId);
    const total = await leadsIn(batch, stageId);
    if (total > 0)
      throw conflict(
        `Move the ${leadCount(total)} in ${current.stage.name} out before archiving it.`,
      );
    if (
      current.stage.category === 'open' &&
      (await otherOpenStages(batch, current.stage.pipelineId, stageId)) === 0
    ) {
      throw conflict('A pipeline needs at least one open stage.');
    }
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .update(schema.stage)
      .set({ archivedAt: new Date(), syncId, updatedAt: new Date() })
      .where(eq(schema.stage.id, stageId))
      .returning();
    const stage = stageRowOf(requireRow(row, 'That stage does not exist.'));
    emitStage(batch, syncId, 'archive', stage, current.brandId);
    return { stage };
  });
}

export async function unarchiveStage(
  context: WriteContext,
  stageId: string,
): Promise<WithActions<{ stage: StageRow }>> {
  assertCan(context.principal, 'pipeline:manage');
  return await withBatch(context, async (batch) => {
    const owned = and(
      eq(schema.stage.id, stageId),
      eq(schema.stage.organizationId, batch.organizationId),
    );
    const [located] = await batch.tx
      .select({ pipelineId: schema.stage.pipelineId })
      .from(schema.stage)
      .where(owned)
      .limit(1);
    if (located === undefined) throw notFound('That stage does not exist.');
    const pipeline = await livePipeline(batch.tx, batch.organizationId, located.pipelineId, true);
    const [current] = await batch.tx
      .select()
      .from(schema.stage)
      .where(owned)
      .limit(1)
      .for('update');
    if (current === undefined) throw notFound('That stage does not exist.');
    if (current.archivedAt === null) throw conflict('That stage is not archived.');
    const live = await liveStagesOf(batch.tx, batch.organizationId, [pipeline.id]);
    const slotTaken = live.some((stage) => stage.sortOrder === current.sortOrder);
    const sortOrder = slotTaken
      ? live.reduce((max, stage) => Math.max(max, stage.sortOrder + 1), 0)
      : current.sortOrder;
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .update(schema.stage)
      .set({ archivedAt: null, sortOrder, syncId, updatedAt: new Date() })
      .where(eq(schema.stage.id, stageId))
      .returning();
    const stage = stageRowOf(requireRow(row, 'That stage does not exist.'));
    emitStage(batch, syncId, 'unarchive', stage, pipeline.brandId);
    return { stage };
  });
}

export async function listStages(principal: Principal): Promise<StageRow[]> {
  assertCan(principal, 'record:read');
  const rows = await db
    .select({ stage: schema.stage })
    .from(schema.stage)
    .innerJoin(schema.pipeline, eq(schema.pipeline.id, schema.stage.pipelineId))
    .where(
      and(
        eq(schema.stage.organizationId, principal.organizationId),
        isNull(schema.stage.archivedAt),
        isNull(schema.pipeline.archivedAt),
      ),
    )
    .orderBy(asc(schema.stage.pipelineId), asc(schema.stage.sortOrder));
  return rows.map((row) => stageRowOf(row.stage));
}
