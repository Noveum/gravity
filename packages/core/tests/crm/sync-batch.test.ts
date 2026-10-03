import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { retryOnUniqueViolation, type SyncBatch, withBatch } from '../../src/crm/sync-batch.ts';
import { newId } from '../../src/internal.ts';
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

async function insertBrand(
  batch: SyncBatch,
  name: string,
): Promise<{ id: string; syncId: number }> {
  const syncId = await batch.nextSyncId();
  const id = newId();
  await batch.tx
    .insert(schema.brand)
    .values({ id, organizationId: batch.organizationId, name, syncId });
  return { id, syncId };
}

async function brandCount(): Promise<number> {
  return (await db.select().from(schema.brand)).length;
}

describe('the write transaction', () => {
  test('a throw after a real write leaves neither the row nor an outbox row', async () => {
    await expect(
      withBatch({ principal: workspace.admin }, async (batch) => {
        const brand = await insertBrand(batch, 'Lumen');
        batch.emit({
          syncId: brand.syncId,
          action: 'insert',
          model: 'brand',
          modelId: brand.id,
          data: { id: brand.id },
          scopes: [`workspace:${batch.organizationId}`],
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await brandCount()).toBe(0);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });

  test('a failing outbox write rolls back the domain row written in the same batch', async () => {
    await db.insert(schema.outbox).values({
      syncId: 900_000,
      organizationId: workspace.organizationId,
      payload: {},
    });
    await expect(
      withBatch({ principal: workspace.admin }, async (batch) => {
        const brand = await insertBrand(batch, 'Lumen');
        batch.emit({
          syncId: 900_000,
          action: 'insert',
          model: 'brand',
          modelId: brand.id,
          data: { id: brand.id },
          scopes: [`workspace:${batch.organizationId}`],
        });
        return {};
      }),
    ).rejects.toThrow();
    expect(await brandCount()).toBe(0);
    expect(await db.select().from(schema.outbox)).toHaveLength(1);
  });

  test('the stored outbox payload carries the client id, actor and scopes', async () => {
    const result = await withBatch(
      { principal: workspace.admin, originClientId: 'tab-9' },
      async (batch) => {
        const brand = await insertBrand(batch, 'Lumen');
        batch.emit({
          syncId: brand.syncId,
          action: 'insert',
          model: 'brand',
          modelId: brand.id,
          data: { id: brand.id },
          scopes: [`workspace:${batch.organizationId}`, 'brand:b1', 'brand:b1'],
        });
        return {};
      },
    );
    const [row] = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.syncId, result.actions[0]?.syncId ?? -1));
    expect(row?.payload['originClientId']).toBe('tab-9');
    expect(row?.payload['actor']).toEqual({ type: 'user', id: workspace.admin.userId });
    expect(row?.payload['scopes']).toEqual([`workspace:${workspace.organizationId}`, 'brand:b1']);
  });

  test('the stored payload has no originClientId key when none was given', async () => {
    await withBatch({ principal: workspace.admin }, async (batch) => {
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
    const [row] = await db.select().from(schema.outbox);
    expect(row).toBeDefined();
    expect(row !== undefined && 'originClientId' in row.payload).toBe(false);
  });
});

describe('batch validation', () => {
  const valid = (batch: SyncBatch) => ({
    action: 'insert' as const,
    model: 'brand' as const,
    modelId: 'b1',
    data: {},
    scopes: [`workspace:${batch.organizationId}`],
  });

  test.each([
    ['an empty model id', { modelId: '' }],
    ['an empty scope', { scopes: [''] }],
    ['no scopes', { scopes: [] }],
  ])('%s rolls the whole write back', async (_name, override) => {
    await expect(
      withBatch({ principal: workspace.admin }, async (batch) => {
        const brand = await insertBrand(batch, 'Lumen');
        batch.emit({ ...valid(batch), syncId: brand.syncId, ...override });
        return {};
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(await brandCount()).toBe(0);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });

  test.each([
    ['an empty client id', ''],
    ['a 65 character client id', 'c'.repeat(65)],
  ])('%s is refused with a 422 before anything is written', async (_name, originClientId) => {
    let ran = false;
    await expect(
      withBatch({ principal: workspace.admin, originClientId }, async () => {
        ran = true;
        return await Promise.resolve({});
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(ran).toBe(false);
  });

  test('a 64 character client id is accepted', async () => {
    const result = await withBatch(
      { principal: workspace.admin, originClientId: 'c'.repeat(64) },
      async (batch) => {
        batch.emit({ ...valid(batch), syncId: await batch.nextSyncId() });
        return {};
      },
    );
    expect(result.actions[0]?.originClientId).toHaveLength(64);
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
