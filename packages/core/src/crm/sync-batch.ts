import { db, sql, type Transaction } from '@gravity/db';
import { internal, validationFailed } from '@gravity/shared/errors';
import {
  originClientIdSchema,
  type SyncAction,
  type SyncActionKind,
  type SyncModel,
  syncActionSchema,
} from '@gravity/shared/events';
import { isTransactionConflict, isUniqueViolation } from '../internal.ts';
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

export const WRITE_TRANSACTION_TIMEOUT = '30s';

async function capTransactionLifetime(tx: Transaction): Promise<void> {
  await tx.execute(sql`
    select
      set_config('statement_timeout', ${WRITE_TRANSACTION_TIMEOUT}, true),
      set_config('idle_in_transaction_session_timeout', ${WRITE_TRANSACTION_TIMEOUT}, true),
      case when current_setting('server_version_num')::int >= 170000
        then set_config('transaction_timeout', ${WRITE_TRANSACTION_TIMEOUT}, true)
      end
  `);
}

const BATCH_ATTEMPTS = 3;
const RETRY_JITTER_MS = 40;

function pauseBeforeRetry(attempt: number): Promise<void> {
  const delay = attempt * 10 + Math.random() * RETRY_JITTER_MS;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export const WRITE_DEADLINE_MS = 30_000;

export function assertWithinWriteDeadline(startedAt: number, now: () => number): void {
  if (now() - startedAt > WRITE_DEADLINE_MS) {
    throw internal('The write took longer than 30 seconds and was rolled back. Try again.');
  }
}

export interface CappedTransactionOptions {
  readonly now?: () => number;
  readonly accessMode?: 'read only' | 'read write';
}

export async function cappedTransaction<T>(
  run: (tx: Transaction) => Promise<T>,
  options: CappedTransactionOptions = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  return await db.transaction(
    async (tx) => {
      const startedAt = now();
      await capTransactionLifetime(tx);
      const result = await run(tx);
      assertWithinWriteDeadline(startedAt, now);
      return result;
    },
    { accessMode: options.accessMode ?? 'read write' },
  );
}

export interface BatchOptions {
  readonly now?: () => number;
}

export async function withBatch<T extends object>(
  context: WriteContext,
  run: (batch: SyncBatch) => Promise<T>,
  options: BatchOptions = {},
): Promise<WithActions<T>> {
  const now = options.now ?? Date.now;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const startedAt = now();
        await capTransactionLifetime(tx);
        const batch = createSyncBatch(tx, context);
        const result = await run(batch);
        assertWithinWriteDeadline(startedAt, now);
        const actions = batch.actions().map(validAction);
        await recordSync(tx, actions);
        return { ...result, actions };
      });
    } catch (error: unknown) {
      if (attempt >= BATCH_ATTEMPTS || !isTransactionConflict(error)) throw error;
      await pauseBeforeRetry(attempt);
    }
  }
}

export async function retryOnUniqueViolation<T>(
  run: () => Promise<T>,
  attempts = 2,
  retryable: (error: unknown) => boolean = () => true,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error: unknown) {
      if (attempt >= attempts || !isUniqueViolation(error) || !retryable(error)) throw error;
    }
  }
}
