import { describe, expect, mock, test } from 'bun:test';
import type { SyncAction, SyncCatchup } from '@gravity/shared/events';
import { QueryClient } from '@tanstack/react-query';
import {
  applyDelta,
  catchUp,
  isSuperseded,
  lastAppliedSyncId,
  noteServerRow,
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
  return { actions, truncated, reset: false, syncId };
}

describe('mutation responses', () => {
  test('a noted server row drops a later echo at or below its sync id', () => {
    const handler = mock();
    const unregister = registerDeltaHandler('member', handler);
    const client = new QueryClient();
    noteServerRow(client, 'member', 'm1', 11);
    applyDelta({ ...base, syncId: 11 }, client);
    applyDelta({ ...base, syncId: 10 }, client);
    applyDelta({ ...base, syncId: 12 }, client);
    expect(handler.mock.calls.map(([action]) => action.syncId)).toEqual([12]);
    unregister();
  });

  test('noting never lowers what was applied and leaves the catch-up cursor alone', () => {
    const client = new QueryClient();
    applyDelta({ ...base, syncId: 15 }, client);
    noteServerRow(client, 'member', 'm1', 12);
    noteServerRow(client, 'member', 'm2', 40);
    expect(lastAppliedSyncId(client)).toBe(15);
    expect(isSuperseded({ ...base, syncId: 14 }, client)).toBe(true);
    expect(isSuperseded({ ...base, modelId: 'm2', syncId: 40 }, client)).toBe(true);
  });

  test('an applied delta is superseded only by a newer one or an answered mutation', () => {
    const client = new QueryClient();
    const applied = { ...base, syncId: 20 };
    applyDelta(applied, client);
    expect(isSuperseded(applied, client)).toBe(false);
    noteServerRow(client, 'member', 'm1', 20);
    expect(isSuperseded(applied, client)).toBe(true);
    expect(isSuperseded({ ...base, syncId: 21 }, client)).toBe(false);
  });
});

describe('catch up', () => {
  test('lets the server choose the window behind the cursor and applies what it missed', async () => {
    const handler = mock();
    const unregister = registerDeltaHandler('member', handler);
    const client = new QueryClient();
    applyDelta({ ...base, modelId: 'a', syncId: 1500 }, client);
    handler.mockClear();
    const requested: [number | null, number][] = [];

    await catchUp(client, (since, cursor) => {
      requested.push([since, cursor]);
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

    expect(requested).toEqual([[null, 1500]]);
    expect(handler.mock.calls.map(([action]) => action.modelId)).toEqual(['late', 'b']);
    expect(lastAppliedSyncId(client)).toBe(1501);
    unregister();
  });

  test('sends only the true cursor on the first page, with no fixed overlap', async () => {
    const client = new QueryClient();
    applyDelta({ ...base, syncId: 2400 }, client);
    const requested: [number | null, number][] = [];
    await catchUp(client, (since, cursor) => {
      requested.push([since, cursor]);
      return Promise.resolve(page([], false, 2400));
    });
    expect(requested).toEqual([[null, 2400]]);
  });

  test('on a reset it refetches every query, skips the page and moves the cursor', async () => {
    const handler = mock();
    const unregister = registerDeltaHandler('member', handler);
    const client = new QueryClient();
    const invalidate = mock(() => Promise.resolve());
    client.invalidateQueries = invalidate as unknown as typeof client.invalidateQueries;
    applyDelta({ ...base, modelId: 'a', syncId: 1500 }, client);
    handler.mockClear();
    let calls = 0;

    await catchUp(client, () => {
      calls += 1;
      return Promise.resolve({
        actions: [{ ...base, modelId: 'b', syncId: 1600 }],
        truncated: true,
        reset: true,
        syncId: 9000,
      });
    });

    expect(calls).toBe(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
    expect(lastAppliedSyncId(client)).toBe(9000);
    unregister();
  });

  test('keeps paging while the response is truncated', async () => {
    const client = new QueryClient();
    const requested: (number | null)[] = [];
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
    expect(requested).toEqual([null, 3, 7]);
    expect(lastAppliedSyncId(client)).toBe(9);
  });

  test('stops when a truncated page does not move the cursor forward', async () => {
    const client = new QueryClient();
    let calls = 0;
    await catchUp(client, (since) => {
      calls += 1;
      return Promise.resolve(page([], true, since ?? 0));
    });
    expect(calls).toBe(1);
  });
});
