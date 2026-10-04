import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { db, eq, schema, sql } from '@gravity/db';
import { DomainError } from '@gravity/shared/errors';
import {
  cappedTransaction,
  retryOnUniqueViolation,
  type SyncBatch,
  WRITE_DEADLINE_MS,
  withBatch,
} from '../../src/crm/sync-batch.ts';
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
  test('cannot live longer than 30 seconds, and the cap ends with it', async () => {
    const settingsOf = async (executor: Pick<typeof db, 'execute'>) => {
      const [row] = await executor.execute<Record<string, string>>(sql`
        select
          current_setting('statement_timeout') as statement,
          current_setting('idle_in_transaction_session_timeout') as idle,
          current_setting('transaction_timeout') as lifetime
      `);
      return row;
    };
    const inside = await withBatch({ principal: workspace.admin }, async (batch) => ({
      settings: await settingsOf(batch.tx),
    }));
    expect(inside.settings).toEqual({ statement: '30s', idle: '30s', lifetime: '30s' });
    expect(await settingsOf(db)).toEqual({ statement: '0', idle: '0', lifetime: '0' });
  });

  test('a batch past its deadline is refused before its outbox rows and rolls back', async () => {
    let clock = 1_000;
    const failure = await withBatch(
      { principal: workspace.admin },
      async (batch) => {
        const brand = await insertBrand(batch, 'Late');
        batch.emit({
          syncId: brand.syncId,
          action: 'insert',
          model: 'brand',
          modelId: brand.id,
          data: { id: brand.id },
          scopes: [`workspace:${batch.organizationId}`],
        });
        clock += 30_001;
        return { brand };
      },
      { now: () => clock },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({ code: 'internal' });
    expect(await brandCount()).toBe(0);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });

  test('a batch within its deadline commits', async () => {
    let clock = 1_000;
    await withBatch(
      { principal: workspace.admin },
      async (batch) => {
        clock += 29_999;
        return { brand: await insertBrand(batch, 'On time') };
      },
      { now: () => clock },
    );
    expect(await brandCount()).toBe(1);
  });

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

describe('transaction conflicts', () => {
  function conflictError(code: string): Error {
    return Object.assign(new Error(`postgres error ${code}`), { code });
  }

  async function emitBrand(batch: SyncBatch): Promise<void> {
    batch.emit({
      syncId: await batch.nextSyncId(),
      action: 'insert',
      model: 'brand',
      modelId: 'b1',
      data: { id: 'b1' },
      scopes: [`workspace:${batch.organizationId}`],
    });
  }

  test('a deadlocked batch reruns from scratch and records its actions once', async () => {
    let attempts = 0;
    const result = await withBatch({ principal: workspace.admin }, async (batch) => {
      attempts += 1;
      await emitBrand(batch);
      if (attempts === 1) {
        throw new Error('the query failed', { cause: conflictError('40P01') });
      }
      return { attempts };
    });
    expect(attempts).toBe(2);
    expect(result.actions).toHaveLength(1);
    const rows = await db.select().from(schema.outbox);
    expect(rows.map((row) => row.syncId)).toEqual(result.actions.map((action) => action.syncId));
  });

  test('a serialization failure retries twice and then gives up', async () => {
    let attempts = 0;
    const attempt = withBatch({ principal: workspace.admin }, async (batch) => {
      attempts += 1;
      await emitBrand(batch);
      throw conflictError('40001');
    });
    await expect(attempt).rejects.toThrow('postgres error 40001');
    expect(attempts).toBe(3);
    expect(await db.select().from(schema.outbox)).toHaveLength(0);
  });

  test('any other failure is not retried', async () => {
    let attempts = 0;
    const attempt = withBatch({ principal: workspace.admin }, async (batch) => {
      attempts += 1;
      await emitBrand(batch);
      throw conflictError('23503');
    });
    await expect(attempt).rejects.toThrow('postgres error 23503');
    expect(attempts).toBe(1);
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

  test('rethrows a unique violation the caller marks as not retryable', async () => {
    let calls = 0;
    const violation = (constraint: string) =>
      Object.assign(new Error(constraint), { code: '23505', constraint_name: constraint });
    const retryable = (error: unknown) =>
      !(error instanceof Error && error.message === 'lead_open_person_pipeline_unique');
    await expect(
      retryOnUniqueViolation(
        () => {
          calls += 1;
          return Promise.reject(violation('lead_open_person_pipeline_unique'));
        },
        2,
        retryable,
      ),
    ).rejects.toThrow('lead_open_person_pipeline_unique');
    expect(calls).toBe(1);

    let others = 0;
    const value = await retryOnUniqueViolation(
      () => {
        others += 1;
        return others === 1
          ? Promise.reject(violation('person_org_primary_email_unique'))
          : Promise.resolve('ok');
      },
      2,
      retryable,
    );
    expect([value, others]).toEqual(['ok', 2]);
  });
});

describe('cappedTransaction', () => {
  test('caps the statement timeout of the transaction it runs', async () => {
    const setting = await cappedTransaction(async (tx) => {
      const [row] = await tx.execute<{ value: string }>(
        sql`select current_setting('statement_timeout') as value`,
      );
      return String(row?.['value'] ?? '');
    });
    expect(setting).toBe('30s');
  });

  test('rolls back a transaction that outlives the write deadline', async () => {
    let clock = 0;
    const attempt = cappedTransaction(
      async (tx) => {
        await tx.insert(schema.outbox).values({
          syncId: 990_001,
          organizationId: workspace.organizationId,
          payload: {},
        });
        clock = WRITE_DEADLINE_MS + 1;
      },
      { now: () => clock },
    );
    await expect(attempt).rejects.toThrow('The write took longer than 30 seconds');
    expect(
      await db.select().from(schema.outbox).where(eq(schema.outbox.syncId, 990_001)),
    ).toHaveLength(0);
  });

  test('a read only transaction refuses writes', async () => {
    const attempt = cappedTransaction(
      (tx) =>
        tx.insert(schema.outbox).values({
          syncId: 990_002,
          organizationId: workspace.organizationId,
          payload: {},
        }),
      { accessMode: 'read only' },
    );
    await expect(attempt).rejects.toMatchObject({ cause: { code: '25006' } });
    expect(
      await db.select().from(schema.outbox).where(eq(schema.outbox.syncId, 990_002)),
    ).toHaveLength(0);
  });
});

describe('transaction ownership', () => {
  const OPENS_ITS_OWN_TRANSACTIONS = new Map<string, { count: number; reason: string }>([
    [
      'core/crm/sync-batch.ts',
      { count: 2, reason: 'cappedTransaction itself and the withBatch retry loop' },
    ],
    ['core/realtime/outbox.ts', { count: 1, reason: 'outbox prune, writes no sync rows' }],
  ]);
  const TRANSACTION_CALL = /\.\s*transaction\s*\(/g;
  const SOURCE_ROOTS = [
    ['core', new URL('../../src/', import.meta.url)],
    ['services', new URL('../../../services/src/', import.meta.url)],
    ['web', new URL('../../../../apps/web/src/', import.meta.url)],
  ] as const;

  async function transactionCalls(): Promise<Map<string, number>> {
    const found = new Map<string, number>();
    for (const [name, root] of SOURCE_ROOTS) {
      const files = await readdir(root, { recursive: true });
      for (const file of files) {
        if (!(file.endsWith('.ts') || file.endsWith('.tsx'))) continue;
        const text = await readFile(new URL(file, root), 'utf8');
        const count = text.match(TRANSACTION_CALL)?.length ?? 0;
        if (count > 0) found.set(`${name}/${file}`, count);
      }
    }
    return found;
  }

  test('only the allowlisted modules open a transaction, each as often as it is allowed', async () => {
    const expected = new Map(
      [...OPENS_ITS_OWN_TRANSACTIONS].map(([file, { count }]) => [file, count] as const),
    );
    expect(await transactionCalls()).toEqual(expected);
  });
});
