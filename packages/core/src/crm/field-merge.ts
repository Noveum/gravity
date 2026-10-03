import type { FieldObject } from '@gravity/shared/constants';
import { type FieldMerge, fieldsMetaSchema, mergeFields } from '@gravity/shared/validators';
import { validateFieldInput } from './field-service.ts';
import type { SyncBatch } from './sync-batch.ts';
import { writeActor } from './write-context.ts';

export interface StoredFields {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly fieldsMeta: unknown;
}

export const NO_STORED_FIELDS: StoredFields = { fields: {}, fieldsMeta: {} };

export async function mergeFieldInputIn(
  batch: SyncBatch,
  object: FieldObject,
  stored: StoredFields,
  input: Readonly<Record<string, unknown>>,
): Promise<FieldMerge> {
  const fields = await validateFieldInput(batch.tx, batch.organizationId, object, null, input);
  return mergeFields(
    stored.fields,
    fieldsMetaSchema.parse(stored.fieldsMeta),
    fields,
    writeActor(batch.context),
    new Date(),
  );
}
