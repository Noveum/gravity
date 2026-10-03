import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import type { SyncAction } from '@gravity/shared/events';
import {
  flushOutbox,
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
      return Promise.resolve();
    });
    expect(await republishStale(30_000, 10, working)).toBe(1);
    expect(delivered).toEqual([1010]);
    const [row] = await db.select().from(schema.outbox).where(eq(schema.outbox.syncId, 1010));
    expect(row?.publishedAt).not.toBeNull();
  });

  test('flushOutbox skips rows that are already published', async () => {
    await recordSync(db, [action(1011)]);
    expect(await flushOutbox([1011])).toBe(1);
    const working = mock(() => Promise.resolve());
    expect(await flushOutbox([1011], working)).toBe(0);
    expect(working).not.toHaveBeenCalled();
  });

  test('republishStale publishes old rows oldest first', async () => {
    await recordSync(db, [action(1005), action(1006)]);
    await db.update(schema.outbox).set({ createdAt: new Date(Date.now() - 60_000) });
    const order: number[] = [];
    const working = mock((actions: SyncAction[]) => {
      order.push(...actions.map((entry) => entry.syncId));
      return Promise.resolve();
    });
    expect(await republishStale(30_000, 10, working)).toBe(2);
    expect(order).toEqual([1005, 1006]);
    const rows = await db.select().from(schema.outbox);
    expect(rows.every((row) => row.publishedAt !== null)).toBe(true);
  });

  test('republishStale leaves recent rows alone', async () => {
    await recordSync(db, [action(1012)]);
    const working = mock(() => Promise.resolve());
    expect(await republishStale(30_000, 10, working)).toBe(0);
    expect(working).not.toHaveBeenCalled();
  });

  test('readOutboxSince replays deletes in order and reports truncation', async () => {
    await recordSync(db, [action(1007), action(1008, 'delete'), action(1009)]);
    const page = await readOutboxSince(organizationId, 1007, 1);
    expect(page.actions.map((row) => [row.syncId, row.action])).toEqual([[1008, 'delete']]);
    expect(page.truncated).toBe(true);
    expect(page.syncId).toBe(1008);
  });
});
