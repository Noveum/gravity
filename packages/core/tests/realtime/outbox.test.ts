import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { db, eq, inArray, schema } from '@gravity/db';
import type { SyncAction } from '@gravity/shared/events';
import {
  flushOutbox,
  latestOutboxSyncId,
  pruneOutbox,
  readOutboxSince,
  recordSync,
  republishStale,
} from '../../src/realtime/outbox.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase } from '../../src/test-support.ts';

let organizationId = '';

function action(syncId: number, kind: SyncAction['action'] = 'update'): SyncAction {
  return {
    syncId,
    organizationId,
    scopes: [`workspace:${organizationId}`],
    action: kind,
    model: 'member',
    modelId: `m${syncId}`,
    data: { syncId },
    actor: { type: 'system', id: 'test' },
    at: new Date(0).toISOString(),
  };
}

const RETENTION_MS = 7 * 24 * 60 * 60_000;

async function ageRows(syncIds: number[]): Promise<void> {
  await db
    .update(schema.outbox)
    .set({ createdAt: new Date(Date.now() - RETENTION_MS - 60_000) })
    .where(inArray(schema.outbox.syncId, syncIds));
}

async function prunedSyncIdOf(id: string): Promise<number | undefined> {
  const [row] = await db
    .select({ prunedSyncId: schema.organization.outboxPrunedSyncId })
    .from(schema.organization)
    .where(eq(schema.organization.id, id));
  return row?.prunedSyncId;
}

beforeEach(async () => {
  await resetDatabase();
  organizationId = (await createWorkspace()).organizationId;
  await db.delete(schema.outbox);
});

afterAll(async () => {
  await closeRealtime();
});

describe('outbox', () => {
  test('recordSync writes one row per action inside the caller transaction', async () => {
    await db.transaction(async (tx) => {
      await recordSync(tx, [action(1001), action(1002)]);
    });
    const rows = await db.select().from(schema.outbox);
    expect(rows.map((row) => row.syncId).sort()).toEqual([1001, 1002]);
    expect(rows.every((row) => row.publishedAt === null)).toBe(true);
  });

  test('a rolled back transaction leaves no outbox row', async () => {
    await db
      .transaction(async (tx) => {
        await recordSync(tx, [action(1003)]);
        throw new Error('rollback');
      })
      .catch(() => undefined);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });

  test('flushOutbox marks rows published only when publishing succeeds', async () => {
    await recordSync(db, [action(1004)]);
    const failing = mock(() => Promise.reject(new Error('redis down')));
    expect(await flushOutbox([1004], failing)).toBe(0);
    const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.syncId, 1004));
    expect(row?.publishedAt).toBeNull();
  });

  test('a row whose publish failed is delivered later by republishStale', async () => {
    await recordSync(db, [action(1010)]);
    const failing = mock(() => Promise.reject(new Error('redis down')));
    expect(await flushOutbox([1010], failing)).toBe(0);
    await db.update(schema.outbox).set({ createdAt: new Date(Date.now() - 60_000) });

    const delivered: number[] = [];
    const working = mock((actions: SyncAction[]) => {
      delivered.push(...actions.map((entry) => entry.syncId));
      return Promise.resolve(true);
    });
    expect(await republishStale(30_000, 10, working)).toBe(1);
    expect(delivered).toEqual([1010]);
    const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.syncId, 1010));
    expect(row?.publishedAt).not.toBeNull();
  });

  test('flushOutbox skips rows that are already published', async () => {
    await recordSync(db, [action(1011)]);
    expect(await flushOutbox([1011], () => Promise.resolve(true))).toBe(1);
    const working = mock(() => Promise.resolve(true));
    expect(await flushOutbox([1011], working)).toBe(0);
    expect(working).not.toHaveBeenCalled();
  });

  test('republishStale publishes old rows oldest first', async () => {
    await recordSync(db, [action(1005), action(1006)]);
    await db.update(schema.outbox).set({ createdAt: new Date(Date.now() - 60_000) });
    const order: number[] = [];
    const working = mock((actions: SyncAction[]) => {
      order.push(...actions.map((entry) => entry.syncId));
      return Promise.resolve(true);
    });
    expect(await republishStale(30_000, 10, working)).toBe(2);
    expect(order).toEqual([1005, 1006]);
    const rows = await db.select().from(schema.outbox);
    expect(rows.every((row) => row.publishedAt !== null)).toBe(true);
  });

  test('republishStale leaves recent rows alone', async () => {
    await recordSync(db, [action(1012)]);
    const working = mock(() => Promise.resolve(true));
    expect(await republishStale(30_000, 10, working)).toBe(0);
    expect(working).not.toHaveBeenCalled();
  });

  test('with no redis configured the default publisher leaves rows pending', async () => {
    expect(process.env['REDIS_URL']).toBe('');
    await recordSync(db, [action(1013)]);
    expect(await flushOutbox([1013])).toBe(0);
    await db.update(schema.outbox).set({ createdAt: new Date(Date.now() - 60_000) });
    expect(await republishStale(30_000, 10)).toBe(0);
    const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.syncId, 1013));
    expect(row?.publishedAt).toBeNull();
  });

  test('a publisher that reports no delivery leaves rows pending without logging', async () => {
    await recordSync(db, [action(1014)]);
    const undelivered = mock(() => Promise.resolve(false));
    expect(await flushOutbox([1014], undelivered)).toBe(0);
    expect(undelivered).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.syncId, 1014));
    expect(row?.publishedAt).toBeNull();
  });

  test('readOutboxSince replays deletes in order and reports truncation', async () => {
    await recordSync(db, [action(1007), action(1008, 'delete'), action(1009)]);
    const page = await readOutboxSince({ organizationId, userId: 'reader' }, 1007, 1);
    expect(page.actions.map((row) => [row.syncId, row.action])).toEqual([[1008, 'delete']]);
    expect(page.truncated).toBe(true);
    expect(page.syncId).toBe(1008);
  });

  test('readOutboxSince keeps only workspace rows and the reader own user rows', async () => {
    const own = { ...action(1020), scopes: ['user:reader'] };
    const foreign = { ...action(1021), scopes: ['user:someone-else'] };
    const both = { ...action(1022), scopes: ['user:someone-else', `workspace:${organizationId}`] };
    await recordSync(db, [action(1019), own, foreign, both]);
    const page = await readOutboxSince({ organizationId, userId: 'reader' }, 0, 10);
    expect(page.actions.map((row) => row.syncId)).toEqual([1019, 1020, 1022]);
    expect(page.truncated).toBe(false);
  });

  test('readOutboxSince pages across filtered rows without losing the cursor', async () => {
    const foreign = (syncId: number) => ({ ...action(syncId), scopes: ['user:someone-else'] });
    await recordSync(db, [action(1030), foreign(1031), foreign(1032), action(1033)]);
    const first = await readOutboxSince({ organizationId, userId: 'reader' }, 0, 1);
    expect([first.actions.map((row) => row.syncId), first.truncated, first.syncId]).toEqual([
      [1030],
      true,
      1030,
    ]);
    const second = await readOutboxSince({ organizationId, userId: 'reader' }, first.syncId, 1);
    expect([second.actions.map((row) => row.syncId), second.truncated]).toEqual([[1033], false]);
  });

  test('latestOutboxSyncId is the workspace maximum and zero when empty', async () => {
    expect(await latestOutboxSyncId(organizationId)).toBe(0);
    const other = (await createWorkspace('Other')).organizationId;
    await db.delete(schema.outbox);
    await recordSync(db, [
      action(1040),
      action(1042),
      { ...action(1043), organizationId: other, scopes: [`workspace:${other}`] },
    ]);
    expect(await latestOutboxSyncId(organizationId)).toBe(1042);
    expect(await latestOutboxSyncId(other)).toBe(1043);
  });

  test('pruneOutbox removes only rows older than the cutoff', async () => {
    await recordSync(db, [action(1050), action(1051), action(1052)]);
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    await db.update(schema.outbox).set({ createdAt: old }).where(eq(schema.outbox.syncId, 1050));
    await db
      .update(schema.outbox)
      .set({ createdAt: new Date(Date.now() - 6 * 24 * 60 * 60_000) })
      .where(eq(schema.outbox.syncId, 1051));
    expect(await pruneOutbox(7 * 24 * 60 * 60_000)).toBe(1);
    const left = await db.select().from(schema.outbox);
    expect(left.map((row) => row.syncId).sort()).toEqual([1051, 1052]);
  });
  test('pruneOutbox records the highest pruned sync id per workspace and never lowers it', async () => {
    const other = (await createWorkspace('Other')).organizationId;
    await db.delete(schema.outbox);
    await recordSync(db, [
      action(1060),
      action(1062),
      action(1063),
      { ...action(1061), organizationId: other, scopes: [`workspace:${other}`] },
    ]);
    await ageRows([1060, 1061, 1062]);
    expect(await pruneOutbox(RETENTION_MS)).toBe(3);
    expect(await prunedSyncIdOf(organizationId)).toBe(1062);
    expect(await prunedSyncIdOf(other)).toBe(1061);

    await db
      .update(schema.organization)
      .set({ outboxPrunedSyncId: 5000 })
      .where(eq(schema.organization.id, organizationId));
    await ageRows([1063]);
    expect(await pruneOutbox(RETENTION_MS)).toBe(1);
    expect(await prunedSyncIdOf(organizationId)).toBe(5000);
  });

  test('readOutboxSince signals a reset when the cursor is older than what was pruned', async () => {
    await recordSync(db, [action(1070), action(1071), action(1072), action(1073)]);
    await ageRows([1070, 1071]);
    await pruneOutbox(RETENTION_MS);

    const page = await readOutboxSince({ organizationId, userId: 'reader' }, 1069, 10);
    expect(page).toEqual({ actions: [], truncated: false, reset: true, syncId: 1073 });
  });

  test('readOutboxSince does not reset a cursor that already covers everything pruned', async () => {
    await recordSync(db, [action(1080), action(1081), action(1082)]);
    await ageRows([1080, 1081]);
    await pruneOutbox(RETENTION_MS);

    const page = await readOutboxSince({ organizationId, userId: 'reader' }, 1081, 10);
    expect([page.reset, page.actions.map((row) => row.syncId)]).toEqual([false, [1082]]);
  });

  test('readOutboxSince judges the reset by the true cursor, not the overlap below it', async () => {
    await recordSync(db, [action(1090), action(1091), action(1092)]);
    await ageRows([1090]);
    await pruneOutbox(RETENTION_MS);

    const page = await readOutboxSince({ organizationId, userId: 'reader' }, 1000, 10, 1091);
    expect([page.reset, page.actions.map((row) => row.syncId)]).toEqual([false, [1091, 1092]]);
    const behind = await readOutboxSince({ organizationId, userId: 'reader' }, 1000, 10, 1089);
    expect(behind.reset).toBe(true);
  });

  test('readOutboxSince never resets a reader that has no cursor yet', async () => {
    await recordSync(db, [action(1100), action(1101)]);
    await ageRows([1100]);
    await pruneOutbox(RETENTION_MS);

    const page = await readOutboxSince({ organizationId, userId: 'reader' }, 0, 10);
    expect([page.reset, page.actions.map((row) => row.syncId)]).toEqual([false, [1101]]);
  });
});
