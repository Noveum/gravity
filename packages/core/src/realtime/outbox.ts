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
  readonly reset: boolean;
  readonly syncId: number;
}

export interface OutboxReader {
  readonly organizationId: string;
  readonly userId: string;
}

async function prunedThrough(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ prunedSyncId: schema.organization.outboxPrunedSyncId })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return row?.prunedSyncId ?? 0;
}

export async function readOutboxSince(
  reader: OutboxReader,
  since: number,
  limit: number,
  cursor: number = since,
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
  const pruned = await prunedThrough(reader.organizationId);
  if (cursor > 0 && pruned > cursor) {
    const latest = await latestOutboxSyncId(reader.organizationId);
    return { actions: [], truncated: false, reset: true, syncId: Math.max(latest, pruned) };
  }
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    actions: toActions(page),
    truncated: rows.length > limit,
    reset: false,
    syncId: last === undefined ? since : last.syncId,
  };
}

export const CATCHUP_WINDOW_SECONDS = 60;

export async function catchUpSince(organizationId: string, cursor: number): Promise<number> {
  if (cursor <= 0) return 0;
  const rows = await db.execute<{ earliest: string | null }>(sql`
    with anchor as (
      select created_at from outbox
      where organization_id = ${organizationId} and sync_id <= ${cursor}
      order by sync_id desc
      limit 1
    )
    select min(outbox.sync_id) as earliest
    from outbox, anchor
    where outbox.organization_id = ${organizationId}
      and outbox.sync_id <= ${cursor}
      and outbox.created_at >= anchor.created_at - make_interval(secs => ${CATCHUP_WINDOW_SECONDS})
      and outbox.created_at <= anchor.created_at + make_interval(secs => ${CATCHUP_WINDOW_SECONDS})
  `);
  const earliest = rows[0]?.earliest;
  if (earliest === null || earliest === undefined) return cursor;
  return Math.min(cursor, Number(earliest) - 1);
}

export async function latestOutboxSyncId(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ latest: sql<string | null>`max(${schema.outbox.syncId})` })
    .from(schema.outbox)
    .where(eq(schema.outbox.organizationId, organizationId));
  return row?.latest == null ? 0 : Number(row.latest);
}

export async function pruneOutbox(olderThanMs: number): Promise<number> {
  return await db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.outbox)
      .where(lt(schema.outbox.createdAt, new Date(Date.now() - olderThanMs)))
      .returning({ syncId: schema.outbox.syncId, organizationId: schema.outbox.organizationId });
    const highestPruned = new Map<string, number>();
    for (const row of removed) {
      highestPruned.set(
        row.organizationId,
        Math.max(highestPruned.get(row.organizationId) ?? 0, row.syncId),
      );
    }
    for (const [organizationId, syncId] of highestPruned) {
      await tx
        .update(schema.organization)
        .set({
          outboxPrunedSyncId: sql`greatest(${schema.organization.outboxPrunedSyncId}, ${syncId})`,
        })
        .where(eq(schema.organization.id, organizationId));
    }
    return removed.length;
  });
}
