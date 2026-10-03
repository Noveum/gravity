import { and, asc, count, db, eq, isNull, schema } from '@gravity/db';
import { defaultStagesFor, type PipelineKind } from '@gravity/shared/constants';
import type { Principal } from '@gravity/shared/policy';
import { assertCan } from '@gravity/shared/policy';
import type { PipelineRow, StageRow } from '@gravity/shared/records';
import { pipelineCreateSchema, pipelineUpdateSchema } from '@gravity/shared/validators';
import { newId, requireRow } from '../internal.ts';
import { asConflict } from './conflicts.ts';
import { liveBrand, livePipeline } from './lookups.ts';
import { pipelineRowOf, stageRowOf } from './rows.ts';
import { pipelineScopes } from './scopes.ts';
import { type SyncBatch, type WithActions, withBatch } from './sync-batch.ts';
import type { WriteContext } from './write-context.ts';

export interface PipelineSeed {
  readonly brandId: string;
  readonly name: string;
  readonly key: string;
  readonly kind: PipelineKind;
}

export async function insertPipelineIn(
  batch: SyncBatch,
  seed: PipelineSeed,
): Promise<{ pipeline: PipelineRow; stages: StageRow[] }> {
  const [siblings] = await batch.tx
    .select({ total: count() })
    .from(schema.pipeline)
    .where(eq(schema.pipeline.brandId, seed.brandId));
  const pipelineSyncId = await batch.nextSyncId();
  const [created] = await batch.tx
    .insert(schema.pipeline)
    .values({
      id: newId(),
      organizationId: batch.organizationId,
      brandId: seed.brandId,
      name: seed.name,
      key: seed.key,
      kind: seed.kind,
      position: siblings?.total ?? 0,
      syncId: pipelineSyncId,
    })
    .returning();
  const pipeline = pipelineRowOf(requireRow(created, 'The pipeline could not be created.'));
  const scopes = pipelineScopes(batch.organizationId, pipeline.brandId, pipeline.id);
  batch.emit({
    syncId: pipelineSyncId,
    action: 'insert',
    model: 'pipeline',
    modelId: pipeline.id,
    data: pipeline,
    scopes,
  });
  const stages: StageRow[] = [];
  for (const [index, seedStage] of defaultStagesFor(seed.kind).entries()) {
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .insert(schema.stage)
      .values({
        id: newId(),
        organizationId: batch.organizationId,
        pipelineId: pipeline.id,
        name: seedStage.name,
        category: seedStage.category,
        sortOrder: index,
        syncId,
      })
      .returning();
    const stage = stageRowOf(requireRow(row, 'The stage could not be created.'));
    stages.push(stage);
    batch.emit({
      syncId,
      action: 'insert',
      model: 'stage',
      modelId: stage.id,
      data: stage,
      scopes,
    });
  }
  return { pipeline, stages };
}

export async function createPipeline(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<{ pipeline: PipelineRow; stages: StageRow[] }>> {
  assertCan(context.principal, 'pipeline:manage');
  const parsed = pipelineCreateSchema.parse(input);
  try {
    return await withBatch(context, async (batch) => {
      await liveBrand(batch.tx, batch.organizationId, parsed.brandId);
      return await insertPipelineIn(batch, parsed);
    });
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function updatePipeline(
  context: WriteContext,
  pipelineId: string,
  input: unknown,
): Promise<WithActions<{ pipeline: PipelineRow }>> {
  assertCan(context.principal, 'pipeline:manage');
  const parsed = pipelineUpdateSchema.parse(input);
  try {
    return await withBatch(context, async (batch) => {
      await livePipeline(batch.tx, batch.organizationId, pipelineId, true);
      const syncId = await batch.nextSyncId();
      const [updated] = await batch.tx
        .update(schema.pipeline)
        .set({
          ...(parsed.name === undefined ? {} : { name: parsed.name }),
          ...(parsed.key === undefined ? {} : { key: parsed.key }),
          syncId,
          updatedAt: new Date(),
        })
        .where(eq(schema.pipeline.id, pipelineId))
        .returning();
      const pipeline = pipelineRowOf(requireRow(updated, 'That pipeline does not exist.'));
      batch.emit({
        syncId,
        action: 'update',
        model: 'pipeline',
        modelId: pipeline.id,
        data: pipeline,
        scopes: pipelineScopes(batch.organizationId, pipeline.brandId, pipeline.id),
      });
      return { pipeline };
    });
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function archivePipelineIn(
  batch: SyncBatch,
  pipelineId: string,
): Promise<PipelineRow> {
  const syncId = await batch.nextSyncId();
  const [updated] = await batch.tx
    .update(schema.pipeline)
    .set({ archivedAt: new Date(), syncId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.pipeline.id, pipelineId),
        eq(schema.pipeline.organizationId, batch.organizationId),
      ),
    )
    .returning();
  const pipeline = pipelineRowOf(requireRow(updated, 'That pipeline does not exist.'));
  batch.emit({
    syncId,
    action: 'archive',
    model: 'pipeline',
    modelId: pipeline.id,
    data: pipeline,
    scopes: pipelineScopes(batch.organizationId, pipeline.brandId, pipeline.id),
  });
  return pipeline;
}

export async function archivePipeline(
  context: WriteContext,
  pipelineId: string,
): Promise<WithActions<{ pipeline: PipelineRow }>> {
  assertCan(context.principal, 'pipeline:manage');
  return await withBatch(context, async (batch) => {
    await livePipeline(batch.tx, batch.organizationId, pipelineId, true);
    return { pipeline: await archivePipelineIn(batch, pipelineId) };
  });
}

export async function listPipelines(principal: Principal): Promise<PipelineRow[]> {
  assertCan(principal, 'record:read');
  const rows = await db
    .select({ pipeline: schema.pipeline })
    .from(schema.pipeline)
    .innerJoin(schema.brand, eq(schema.brand.id, schema.pipeline.brandId))
    .where(
      and(
        eq(schema.pipeline.organizationId, principal.organizationId),
        isNull(schema.pipeline.archivedAt),
        isNull(schema.brand.archivedAt),
      ),
    )
    .orderBy(asc(schema.brand.name), asc(schema.pipeline.position), asc(schema.pipeline.name));
  return rows.map((row) => pipelineRowOf(row.pipeline));
}
