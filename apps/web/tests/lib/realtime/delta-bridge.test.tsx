import { describe, expect, mock, test } from 'bun:test';
import type { SyncAction, SyncCatchup } from '@gravity/shared/events';
import { QueryClient } from '@tanstack/react-query';
import {
  applyDelta,
  CATCHUP_OVERLAP,
  catchUp,
  lastAppliedSyncId,
  registerDeltaHandler,
} from '@/lib/realtime/delta-bridge.tsx';

const base: SyncAction = {
  syncId: 9,
  organizationId: 'o1',
  scopes: ['workspace:o1'],
  action: 'update',
  model: 'member',
  modelId: 'm1',
  data: {},
  actor: { type: 'user', id: 'u1' },
  at: new Date(0).toISOString(),
};

describe('delta bridge', () => {
  test('routes an action to the handler registered for its model', () => {
    const handler = mock();
    const other = mock();
    const unregister = registerDeltaHandler('member', handler);
    const unregisterOther = registerDeltaHandler('invitation', other);
    const client = new QueryClient();
    applyDelta(base, client);
    expect(handler).toHaveBeenCalledWith(base, client);
    expect(other).not.toHaveBeenCalled();
    unregister();
    unregisterOther();
  });

  test('stops calling a handler once it is unregistered', () => {
    const handler = mock();
    const unregister = registerDeltaHandler('member', handler);
    unregister();
    applyDelta(base, new QueryClient());
    expect(handler).not.toHaveBeenCalled();
  });

  test('judges staleness per record, never globally', () => {
    const handler = mock();
    const unregister = registerDeltaHandler('member', handler);
    const client = new QueryClient();
    applyDelta({ ...base, modelId: 'a', syncId: 20 }, client);
    applyDelta({ ...base, modelId: 'b', syncId: 19 }, client);
    applyDelta({ ...base, modelId: 'a', syncId: 19 }, client);
    applyDelta({ ...base, modelId: 'a', syncId: 20 }, client);
    expect(handler.mock.calls.map(([action]) => [action.modelId, action.syncId])).toEqual([
      ['a', 20],
      ['b', 19],
    ]);
    unregister();
  });

  test('keeps the same record id apart across models', () => {
    const handler = mock();
    const unregister = registerDeltaHandler('invitation', handler);
    const client = new QueryClient();
    applyDelta({ ...base, model: 'member', modelId: 'x', syncId: 30 }, client);
    applyDelta({ ...base, model: 'invitation', modelId: 'x', syncId: 29 }, client);
    expect(handler).toHaveBeenCalledTimes(1);
    unregister();
  });

  test('reports the highest sync id seen as the cursor, per query client', () => {
    const client = new QueryClient();
    const untouched = new QueryClient();
    expect(lastAppliedSyncId(client)).toBe(0);
    applyDelta({ ...base, modelId: 'a', syncId: 20 }, client);
    applyDelta({ ...base, modelId: 'b', syncId: 19 }, client);
    applyDelta({ ...base, modelId: 'a', syncId: 18 }, client);
    expect(lastAppliedSyncId(client)).toBe(20);
    expect(lastAppliedSyncId(untouched)).toBe(0);
  });
});

function page(actions: SyncAction[], truncated: boolean, syncId: number): SyncCatchup {
  return { actions, truncated, syncId };
}

describe('catch up', () => {
  test('asks for an overlap below the cursor and applies what it missed', async () => {
    const handler = mock();
    const unregister = registerDeltaHandler('member', handler);
    const client = new QueryClient();
    applyDelta({ ...base, modelId: 'a', syncId: 1500 }, client);
    handler.mockClear();
    const requested: number[] = [];

    await catchUp(client, (since) => {
      requested.push(since);
      return Promise.resolve(
        page(
          [
            { ...base, modelId: 'a', syncId: 1500 },
            { ...base, modelId: 'late', syncId: 1499 },
            { ...base, modelId: 'b', syncId: 1501, action: 'delete' },
          ],
          false,
          1501,
        ),
      );
    });

    expect(requested).toEqual([1500 - CATCHUP_OVERLAP]);
    expect(handler.mock.calls.map(([action]) => action.modelId)).toEqual(['late', 'b']);
    expect(lastAppliedSyncId(client)).toBe(1501);
    unregister();
  });

  test('never asks below zero', async () => {
    const client = new QueryClient();
    applyDelta({ ...base, syncId: 40 }, client);
    const requested: number[] = [];
    await catchUp(client, (since) => {
      requested.push(since);
      return Promise.resolve(page([], false, since));
    });
    expect(requested).toEqual([0]);
  });

  test('keeps paging while the response is truncated', async () => {
    const client = new QueryClient();
    const requested: number[] = [];
    const pages = [
      page([{ ...base, modelId: 'a', syncId: 3 }], true, 3),
      page([{ ...base, modelId: 'b', syncId: 7 }], true, 7),
      page([{ ...base, modelId: 'c', syncId: 9 }], false, 9),
    ];
    await catchUp(client, (since) => {
      requested.push(since);
      const next = pages.shift();
      if (next === undefined) throw new Error('asked for too many pages');
      return Promise.resolve(next);
    });
    expect(requested).toEqual([0, 3, 7]);
    expect(lastAppliedSyncId(client)).toBe(9);
  });

  test('stops when a truncated page does not move the cursor forward', async () => {
    const client = new QueryClient();
    let calls = 0;
    await catchUp(client, (since) => {
      calls += 1;
      return Promise.resolve(page([], true, since));
    });
    expect(calls).toBe(1);
  });
});
