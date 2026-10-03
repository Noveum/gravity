import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, schema } from '@gravity/db';
import { retryOnUniqueViolation, withBatch } from '../../src/crm/sync-batch.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

let workspace: TestWorkspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  await db.delete(schema.outbox);
});

afterAll(async () => {
  await closeRealtime();
});

describe('withBatch', () => {
  test('records every emitted action with the actor and the client id', async () => {
    const result = await withBatch(
      { principal: workspace.admin, originClientId: 'tab-1' },
      async (batch) => {
        const syncId = await batch.nextSyncId();
        batch.emit({
          syncId,
          action: 'insert',
          model: 'brand',
          modelId: 'b1',
          data: { id: 'b1' },
          scopes: [`workspace:${batch.organizationId}`],
        });
        return { value: 42 };
      },
    );
    expect(result.value).toBe(42);
    expect(result.actions[0]).toMatchObject({
      originClientId: 'tab-1',
      organizationId: workspace.organizationId,
      actor: { type: 'user', id: workspace.admin.userId },
    });
    const rows = await db.select().from(schema.outbox);
    expect(rows.map((row) => row.syncId)).toEqual(result.actions.map((action) => action.syncId));
  });

  test('an explicit actor replaces the principal', async () => {
    const actor = { type: 'agent' as const, id: 'claude', name: 'Claude for Ada' };
    const result = await withBatch({ principal: workspace.admin, actor }, async (batch) => {
      batch.emit({
        syncId: await batch.nextSyncId(),
        action: 'update',
        model: 'brand',
        modelId: 'b1',
        data: {},
        scopes: ['workspace:x'],
      });
      return {};
    });
    expect(result.actions[0]?.actor).toEqual(actor);
    expect(result.actions[0]?.originClientId).toBeUndefined();
  });

  test('a failure inside the batch leaves no outbox row', async () => {
    await expect(
      withBatch({ principal: workspace.admin }, async (batch) => {
        batch.emit({
          syncId: await batch.nextSyncId(),
          action: 'insert',
          model: 'brand',
          modelId: 'b1',
          data: {},
          scopes: ['workspace:x'],
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });

  test('a batch that emits nothing writes nothing', async () => {
    const result = await withBatch({ principal: workspace.admin }, () => Promise.resolve({}));
    expect(result.actions).toEqual([]);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });
});

describe('retryOnUniqueViolation', () => {
  test('retries a unique violation once and nothing else', async () => {
    let calls = 0;
    const value = await retryOnUniqueViolation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(Object.assign(new Error('duplicate'), { code: '23505' }));
      }
      return Promise.resolve('ok');
    });
    expect([value, calls]).toEqual(['ok', 2]);

    let other = 0;
    await expect(
      retryOnUniqueViolation(() => {
        other += 1;
        return Promise.reject(new Error('nope'));
      }),
    ).rejects.toThrow('nope');
    expect(other).toBe(1);
  });

  test('gives up after the allowed attempts', async () => {
    let calls = 0;
    await expect(
      retryOnUniqueViolation(() => {
        calls += 1;
        return Promise.reject(Object.assign(new Error('duplicate'), { code: '23505' }));
      }),
    ).rejects.toThrow('duplicate');
    expect(calls).toBe(2);
  });
});
