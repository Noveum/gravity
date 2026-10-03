import { and, asc, count, db, eq, isNull, or, schema } from '@gravity/db';
import type { FieldObject } from '@gravity/shared/constants';
import { conflict, notFound, validationFailed } from '@gravity/shared/errors';
import { scopes } from '@gravity/shared/events';
import type { Principal } from '@gravity/shared/policy';
import { assertCan } from '@gravity/shared/policy';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import {
  type FieldValue,
  fieldDefinitionCreateSchema,
  fieldDefinitionUpdateSchema,
  fieldValuesSchema,
} from '@gravity/shared/validators';
import { type Executor, newId, requireRow } from '../internal.ts';
import { lockOrganization } from '../org/organization-lock.ts';
import { asConflict } from './conflicts.ts';
import { livePipeline } from './lookups.ts';
import { fieldDefinitionRowOf } from './rows.ts';
import { type SyncBatch, type WithActions, withBatch } from './sync-batch.ts';
import type { WriteContext } from './write-context.ts';

function emitField(
  batch: SyncBatch,
  syncId: number,
  action: 'insert' | 'update' | 'archive',
  field: FieldDefinitionRow,
): void {
  batch.emit({
    syncId,
    action,
    model: 'field_definition',
    modelId: field.id,
    data: field,
    scopes: [scopes.workspace(batch.organizationId)],
  });
}

async function liveField(batch: SyncBatch, fieldId: string) {
  const [row] = await batch.tx
    .select()
    .from(schema.fieldDefinition)
    .where(
      and(
        eq(schema.fieldDefinition.id, fieldId),
        eq(schema.fieldDefinition.organizationId, batch.organizationId),
        isNull(schema.fieldDefinition.archivedAt),
      ),
    )
    .limit(1)
    .for('update');
  if (row === undefined) throw notFound('That custom field does not exist.');
  return row;
}

async function assertKeyIsFree(
  batch: SyncBatch,
  object: FieldObject,
  pipelineId: string | null,
  key: string,
): Promise<void> {
  const rows = await batch.tx
    .select({ pipelineId: schema.fieldDefinition.pipelineId })
    .from(schema.fieldDefinition)
    .where(
      and(
        eq(schema.fieldDefinition.organizationId, batch.organizationId),
        eq(schema.fieldDefinition.object, object),
        eq(schema.fieldDefinition.key, key),
        isNull(schema.fieldDefinition.archivedAt),
      ),
    );
  if (rows.some((row) => row.pipelineId === pipelineId)) {
    throw conflict('A custom field with that key already exists here.');
  }
  if (pipelineId === null && rows.length > 0) {
    throw conflict('A pipeline already has a custom field with that key. Use another key.');
  }
  if (pipelineId !== null && rows.some((row) => row.pipelineId === null)) {
    throw conflict('A workspace-wide custom field already uses that key. Use another key.');
  }
}

export async function createFieldDefinition(
  context: WriteContext,
  input: unknown,
): Promise<WithActions<{ field: FieldDefinitionRow }>> {
  assertCan(context.principal, 'field:manage');
  const parsed = fieldDefinitionCreateSchema.parse(input);
  if (parsed.pipelineId !== null && parsed.object !== 'lead' && parsed.object !== 'deal') {
    throw validationFailed('Only lead and deal fields can belong to a pipeline.');
  }
  try {
    return await withBatch(context, async (batch) => {
      await lockOrganization(batch.tx, batch.organizationId);
      if (parsed.pipelineId !== null) {
        await livePipeline(batch.tx, batch.organizationId, parsed.pipelineId, true);
      }
      await assertKeyIsFree(batch, parsed.object, parsed.pipelineId, parsed.key);
      const [siblings] = await batch.tx
        .select({ total: count() })
        .from(schema.fieldDefinition)
        .where(
          and(
            eq(schema.fieldDefinition.organizationId, batch.organizationId),
            eq(schema.fieldDefinition.object, parsed.object),
          ),
        );
      const syncId = await batch.nextSyncId();
      const [row] = await batch.tx
        .insert(schema.fieldDefinition)
        .values({
          id: newId(),
          organizationId: batch.organizationId,
          ...parsed,
          position: siblings?.total ?? 0,
          syncId,
        })
        .returning();
      const field = fieldDefinitionRowOf(requireRow(row, 'The custom field could not be created.'));
      emitField(batch, syncId, 'insert', field);
      return { field };
    });
  } catch (error: unknown) {
    throw asConflict(error);
  }
}

export async function updateFieldDefinition(
  context: WriteContext,
  fieldId: string,
  input: unknown,
): Promise<WithActions<{ field: FieldDefinitionRow }>> {
  assertCan(context.principal, 'field:manage');
  const parsed = fieldDefinitionUpdateSchema.parse(input);
  return await withBatch(context, async (batch) => {
    const current = await liveField(batch, fieldId);
    if (
      parsed.options !== undefined &&
      current.type !== 'select' &&
      current.type !== 'multi_select'
    ) {
      throw validationFailed('Only choice fields have options.');
    }
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .update(schema.fieldDefinition)
      .set({
        ...(parsed.label === undefined ? {} : { label: parsed.label }),
        ...(parsed.options === undefined ? {} : { options: parsed.options }),
        ...(parsed.description === undefined ? {} : { description: parsed.description }),
        ...(parsed.example === undefined ? {} : { example: parsed.example }),
        syncId,
        updatedAt: new Date(),
      })
      .where(eq(schema.fieldDefinition.id, fieldId))
      .returning();
    const field = fieldDefinitionRowOf(requireRow(row, 'That custom field does not exist.'));
    emitField(batch, syncId, 'update', field);
    return { field };
  });
}

export async function archiveFieldDefinition(
  context: WriteContext,
  fieldId: string,
): Promise<WithActions<{ field: FieldDefinitionRow }>> {
  assertCan(context.principal, 'field:manage');
  return await withBatch(context, async (batch) => {
    await liveField(batch, fieldId);
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .update(schema.fieldDefinition)
      .set({ archivedAt: new Date(), syncId, updatedAt: new Date() })
      .where(eq(schema.fieldDefinition.id, fieldId))
      .returning();
    const field = fieldDefinitionRowOf(requireRow(row, 'That custom field does not exist.'));
    emitField(batch, syncId, 'archive', field);
    return { field };
  });
}

export async function archiveFieldsOfPipelineIn(
  batch: SyncBatch,
  pipelineId: string,
): Promise<void> {
  const fields = await batch.tx
    .select({ id: schema.fieldDefinition.id })
    .from(schema.fieldDefinition)
    .where(
      and(
        eq(schema.fieldDefinition.organizationId, batch.organizationId),
        eq(schema.fieldDefinition.pipelineId, pipelineId),
        isNull(schema.fieldDefinition.archivedAt),
      ),
    )
    .orderBy(asc(schema.fieldDefinition.position));
  for (const { id } of fields) {
    const syncId = await batch.nextSyncId();
    const [row] = await batch.tx
      .update(schema.fieldDefinition)
      .set({ archivedAt: new Date(), syncId, updatedAt: new Date() })
      .where(eq(schema.fieldDefinition.id, id))
      .returning();
    emitField(
      batch,
      syncId,
      'archive',
      fieldDefinitionRowOf(requireRow(row, 'That custom field does not exist.')),
    );
  }
}

export async function listFieldDefinitions(principal: Principal): Promise<FieldDefinitionRow[]> {
  assertCan(principal, 'record:read');
  const rows = await db
    .select({ field: schema.fieldDefinition })
    .from(schema.fieldDefinition)
    .leftJoin(schema.pipeline, eq(schema.pipeline.id, schema.fieldDefinition.pipelineId))
    .where(
      and(
        eq(schema.fieldDefinition.organizationId, principal.organizationId),
        isNull(schema.fieldDefinition.archivedAt),
        isNull(schema.pipeline.archivedAt),
      ),
    )
    .orderBy(asc(schema.fieldDefinition.object), asc(schema.fieldDefinition.position));
  return rows.map((row) => fieldDefinitionRowOf(row.field));
}

export async function loadFieldDefinitions(
  executor: Executor,
  organizationId: string,
  object: FieldObject,
  pipelineId: string | null,
): Promise<FieldDefinitionRow[]> {
  const rows = await executor
    .select()
    .from(schema.fieldDefinition)
    .where(
      and(
        eq(schema.fieldDefinition.organizationId, organizationId),
        eq(schema.fieldDefinition.object, object),
        isNull(schema.fieldDefinition.archivedAt),
        pipelineId === null
          ? isNull(schema.fieldDefinition.pipelineId)
          : or(
              isNull(schema.fieldDefinition.pipelineId),
              eq(schema.fieldDefinition.pipelineId, pipelineId),
            ),
      ),
    )
    .orderBy(asc(schema.fieldDefinition.position));
  return rows.map(fieldDefinitionRowOf);
}

export async function validateFieldInput(
  executor: Executor,
  organizationId: string,
  object: FieldObject,
  pipelineId: string | null,
  input: Readonly<Record<string, unknown>>,
): Promise<Record<string, FieldValue>> {
  if (Object.keys(input).length === 0) return {};
  const definitions = await loadFieldDefinitions(executor, organizationId, object, pipelineId);
  return fieldValuesSchema(definitions).parse(input);
}
