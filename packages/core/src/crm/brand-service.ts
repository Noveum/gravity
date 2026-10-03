import { and, asc, db, eq, isNull, schema } from '@gravity/db';
import { DEFAULT_PIPELINE_NAME } from '@gravity/shared/constants';
import { conflict } from '@gravity/shared/errors';
import type { Principal } from '@gravity/shared/policy';
import { assertCan } from '@gravity/shared/policy';
import type { BrandRow, PipelineRow, StageRow } from '@gravity/shared/records';
import { derivePipelineKey } from '@gravity/shared/utils';
import { brandCreateSchema, brandUpdateSchema } from '@gravity/shared/validators';
import { newId, requireRow } from '../internal.ts';
import { asConflict } from './conflicts.ts';
import { liveBrand, openLeadCount, takenPipelineKeys } from './lookups.ts';
import { archivePipelineIn, insertPipelineIn, openLeadsPhrase } from './pipeline-service.ts';
import { brandRowOf } from './rows.ts';
import { brandScopes } from './scopes.ts';
import { type SyncBatch, type WithActions, withBatch } from './sync-batch.ts';
import type { WriteContext } from './write-context.ts';

function emitBrand(
  batch: SyncBatch,
  syncId: number,
  action: 'insert' | 'update' | 'archive',
  brand: BrandRow,
): void {
  batch.emit({
    syncId,
    action,
    model: 'brand',
    modelId: brand.id,
    data: brand,
    scopes: brandScopes(batch.organizationId, brand.id),
  });
}

export async function createBrand(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<{ brand: BrandRow; pipeline: PipelineRow; stages: StageRow[] }>> {
  assertCan(context.principal, 'pipeline:manage');
  const parsed = brandCreateSchema.parse(input);
  try {
    return await withBatch(context, async (batch) => {
      const syncId = await batch.nextSyncId();
      const [created] = await batch.tx
        .insert(schema.brand)
        .values({
          id: newId(),
          organizationId: batch.organizationId,
          name: parsed.name,
          domain: parsed.domain,
          color: parsed.color,
          signature: parsed.signature,
          syncId,
        })
        .returning();
      const brand = brandRowOf(requireRow(created, 'The brand could not be created.'));
      await batch.tx.insert(schema.playbookVersion).values({
        id: newId(),
        organizationId: batch.organizationId,
        brandId: brand.id,
        version: 1,
        createdBy: context.principal.userId,
      });
      emitBrand(batch, syncId, 'insert', brand);
      const key =
        parsed.pipelineKey ??
        derivePipelineKey(parsed.name, await takenPipelineKeys(batch.tx, batch.organizationId));
      const { pipeline, stages } = await insertPipelineIn(batch, {
        brandId: brand.id,
        name: DEFAULT_PIPELINE_NAME.people,
        key,
        kind: 'people',
      });
      return { brand, pipeline, stages };
    });
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function updateBrand(
  context: WriteContext,
  brandId: string,
  input: unknown,
): Promise<WithActions<{ brand: BrandRow }>> {
  assertCan(context.principal, 'pipeline:manage');
  const parsed = brandUpdateSchema.parse(input);
  try {
    return await withBatch(context, async (batch) => {
      await liveBrand(batch.tx, batch.organizationId, brandId, true);
      const syncId = await batch.nextSyncId();
      const [updated] = await batch.tx
        .update(schema.brand)
        .set({
          ...(parsed.name === undefined ? {} : { name: parsed.name }),
          ...(parsed.domain === undefined ? {} : { domain: parsed.domain }),
          ...(parsed.color === undefined ? {} : { color: parsed.color }),
          ...(parsed.signature === undefined ? {} : { signature: parsed.signature }),
          syncId,
          updatedAt: new Date(),
        })
        .where(eq(schema.brand.id, brandId))
        .returning();
      const brand = brandRowOf(requireRow(updated, 'That brand does not exist.'));
      emitBrand(batch, syncId, 'update', brand);
      return { brand };
    });
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function archiveBrand(
  context: WriteContext,
  brandId: string,
): Promise<WithActions<{ brand: BrandRow }>> {
  assertCan(context.principal, 'pipeline:manage');
  return await withBatch(context, async (batch) => {
    const current = await liveBrand(batch.tx, batch.organizationId, brandId, true);
    const pipelines = await batch.tx
      .select({ id: schema.pipeline.id })
      .from(schema.pipeline)
      .where(and(eq(schema.pipeline.brandId, brandId), isNull(schema.pipeline.archivedAt)))
      .orderBy(asc(schema.pipeline.position), asc(schema.pipeline.id))
      .for('update');
    const pipelineIds = pipelines.map((pipeline) => pipeline.id);
    const open = await openLeadCount(batch.tx, batch.organizationId, pipelineIds);
    if (open > 0)
      throw conflict(`Close the ${openLeadsPhrase(open)} in ${current.name} before archiving it.`);
    const syncId = await batch.nextSyncId();
    const [updated] = await batch.tx
      .update(schema.brand)
      .set({ archivedAt: new Date(), syncId, updatedAt: new Date() })
      .where(eq(schema.brand.id, brandId))
      .returning();
    const brand = brandRowOf(requireRow(updated, 'That brand does not exist.'));
    emitBrand(batch, syncId, 'archive', brand);
    for (const pipelineId of pipelineIds) await archivePipelineIn(batch, pipelineId);
    return { brand };
  });
}

export async function listBrands(principal: Principal): Promise<BrandRow[]> {
  assertCan(principal, 'record:read');
  const rows = await db
    .select()
    .from(schema.brand)
    .where(
      and(
        eq(schema.brand.organizationId, principal.organizationId),
        isNull(schema.brand.archivedAt),
      ),
    )
    .orderBy(asc(schema.brand.name));
  return rows.map(brandRowOf);
}
