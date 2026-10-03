import { db, type Transaction } from '@gravity/db';
import { internal, validationFailed } from '@gravity/shared/errors';
import {
  originClientIdSchema,
  type SyncAction,
  type SyncActionKind,
  type SyncModel,
  syncActionSchema,
} from '@gravity/shared/events';
import { isUniqueViolation } from '../internal.ts';
import { recordSync } from '../realtime/outbox.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { type WriteContext, writeActor } from './write-context.ts';

export interface EmitInput {
  readonly syncId: number;
  readonly action: SyncActionKind;
  readonly model: SyncModel;
  readonly modelId: string;
  readonly data: Record<string, unknown>;
  readonly scopes: readonly string[];
}

export interface SyncBatch {
  readonly tx: Transaction;
  readonly context: WriteContext;
  readonly organizationId: string;
  nextSyncId(): Promise<number>;
  emit(input: EmitInput): void;
  actions(): readonly SyncAction[];
}

export type WithActions<T> = T & { readonly actions: SyncAction[] };

export function createSyncBatch(tx: Transaction, context: WriteContext): SyncBatch {
  if (
    context.originClientId !== undefined &&
    !originClientIdSchema.safeParse(context.originClientId).success
  ) {
    throw validationFailed('The client id is not valid.');
  }
  const emitted: SyncAction[] = [];
  const actor = writeActor(context);
  const organizationId = context.principal.organizationId;
  return {
    tx,
    context,
    organizationId,
    nextSyncId: () => nextSyncId(tx),
    emit: (input) => {
      emitted.push(
        buildSyncAction({
          ...input,
          organizationId,
          actor,
          originClientId: context.originClientId,
        }),
      );
    },
    actions: () => emitted,
  };
}

function validAction(action: SyncAction): SyncAction {
  const parsed = syncActionSchema.safeParse(action);
  if (!parsed.success) {
    throw internal(
      `Refusing to record a malformed sync action for ${action.model} ${action.modelId}.`,
      parsed.error,
    );
  }
  return parsed.data;
}

export async function withBatch<T extends object>(
  context: WriteContext,
  run: (batch: SyncBatch) => Promise<T>,
): Promise<WithActions<T>> {
  return await db.transaction(async (tx) => {
    const batch = createSyncBatch(tx, context);
    const result = await run(batch);
    const actions = batch.actions().map(validAction);
    await recordSync(tx, actions);
    return { ...result, actions };
  });
}

export async function retryOnUniqueViolation<T>(run: () => Promise<T>, attempts = 2): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error: unknown) {
      if (attempt >= attempts || !isUniqueViolation(error)) throw error;
    }
  }
}
