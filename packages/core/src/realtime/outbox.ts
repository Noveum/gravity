import { and, asc, db, eq, gt, inArray, isNull, lt, schema, sql } from '@gravity/db';
import { type SyncAction, scopes, syncActionSchema } from '@gravity/shared/events';
import type { Executor } from '../internal.ts';
import { publishDeltas } from './publisher.ts';

type Publish = (actions: SyncAction[]) => Promise<boolean>;

interface OutboxRow {
  readonly syncId: number;
  readonly payload: Record<string, unknown>;
}

export async function recordSync(
  executor: Executor,
  actions: readonly SyncAction[],
): Promise<void> {
  if (actions.length === 0) return;
  await executor.insert(schema.outbox).values(
    actions.map((action) => ({
      syncId: action.syncId,
      organizationId: action.organizationId,
      payload: action,
    })),
  );
}

function toActions(rows: readonly OutboxRow[]): SyncAction[] {
  return rows.map((row) => syncActionSchema.parse(row.payload));
}

async function publishRows(rows: readonly OutboxRow[], publish: Publish): Promise<number> {
  if (rows.length === 0) return 0;
  let delivered: boolean;
  try {
    delivered = await publish(toActions(rows));
  } catch (error: unknown) {
    console.error('[gravity] outbox publish failed, rows stay pending', error);
    return 0;
  }
  if (!delivered) return 0;
  await db
    .update(schema.outbox)
    .set({ publishedAt: new Date() })
    .where(
      inArray(
        schema.outbox.syncId,
        rows.map((row) => row.syncId),
      ),
    );
  return rows.length;
}

export async function flushOutbox(
  syncIds: readonly number[],
  publish: Publish = publishDeltas,
): Promise<number> {
  if (syncIds.length === 0) return 0;
  const rows = await db
    .select({ syncId: schema.outbox.syncId, payload: schema.outbox.payload })
    .from(schema.outbox)
    .where(and(inArray(schema.outbox.syncId, [...syncIds]), isNull(schema.outbox.publishedAt)))
    .orderBy(asc(schema.outbox.syncId));
  return await publishRows(rows, publish);
}

export async function republishStale(
  olderThanMs: number,
  limit: number,
  publish: Publish = publishDeltas,
): Promise<number> {
  const rows = await db
    .select({ syncId: schema.outbox.syncId, payload: schema.outbox.payload })
    .from(schema.outbox)
    .where(
      and(
        isNull(schema.outbox.publishedAt),
        lt(schema.outbox.createdAt, new Date(Date.now() - olderThanMs)),
      ),
    )
    .orderBy(asc(schema.outbox.syncId))
    .limit(limit);
  return await publishRows(rows, publish);
}

export interface OutboxPage {
  readonly actions: SyncAction[];
  readonly truncated: boolean;
  readonly syncId: number;
}

export interface OutboxReader {
  readonly organizationId: string;
  readonly userId: string;
}

export async function readOutboxSince(
  reader: OutboxReader,
  since: number,
  limit: number,
): Promise<OutboxPage> {
  const readable = [scopes.workspace(reader.organizationId), scopes.user(reader.userId)];
  const rows = await db
    .select({ syncId: schema.outbox.syncId, payload: schema.outbox.payload })
    .from(schema.outbox)
    .where(
      and(
        eq(schema.outbox.organizationId, reader.organizationId),
        gt(schema.outbox.syncId, since),
        sql`${schema.outbox.payload} -> 'scopes' ?| array[${readable[0]}, ${readable[1]}]::text[]`,
      ),
    )
    .orderBy(asc(schema.outbox.syncId))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    actions: toActions(page),
    truncated: rows.length > limit,
    syncId: last === undefined ? since : last.syncId,
  };
}

export async function latestOutboxSyncId(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ latest: sql<string | null>`max(${schema.outbox.syncId})` })
    .from(schema.outbox)
    .where(eq(schema.outbox.organizationId, organizationId));
  return row?.latest == null ? 0 : Number(row.latest);
}

export async function pruneOutbox(olderThanMs: number): Promise<number> {
  const removed = await db
    .delete(schema.outbox)
    .where(lt(schema.outbox.createdAt, new Date(Date.now() - olderThanMs)))
    .returning({ syncId: schema.outbox.syncId });
  return removed.length;
}
