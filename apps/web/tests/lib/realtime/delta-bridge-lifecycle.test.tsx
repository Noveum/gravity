import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realtimeClient from '@gravity/realtime-client/react';
import type { SyncAction, SyncCatchup } from '@gravity/shared/events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile(['@gravity/realtime-client/react']);

let status = 'connecting';
let resumeHandler: (() => void) | null = null;

mock.module('@gravity/realtime-client/react', () => ({
  ...realtimeClient,
  useRealtimeStatus: () => status,
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
  useResumeHandler: (handler: () => void) => {
    resumeHandler = handler;
  },
}));

const { DeltaBridge } = await import('@/lib/realtime/delta-bridge.tsx');

const requests: string[] = [];
let respond: (since: number) => SyncCatchup | Error = (since) => ({
  actions: [],
  truncated: false,
  syncId: since,
});

const savedFetch = globalThis.fetch;

beforeEach(() => {
  requests.length = 0;
  status = 'connecting';
  resumeHandler = null;
  respond = (since) => ({ actions: [], truncated: false, syncId: since });
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const since = Number(new URL(url, 'http://localhost').searchParams.get('since'));
    const answer = respond(since);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
  }) as unknown as typeof fetch;
});

function mount(client: QueryClient, initialCursor: number) {
  const tree = () => (
    <QueryClientProvider client={client}>
      <DeltaBridge organizationId="o1" userId="u1" initialCursor={initialCursor} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    view,
    reopen(next: string) {
      status = next;
      view.rerender(tree());
    },
  };
}

afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe('DeltaBridge catch-up lifecycle', () => {
  test('catches up from the seeded cursor on the first ready, not before and not twice', async () => {
    const mounted = mount(new QueryClient(), 5000);
    expect(requests).toEqual([]);

    mounted.reopen('open');
    await waitFor(() => expect(requests).toEqual(['/api/sync?since=4000']));

    mounted.reopen('reconnecting');
    mounted.reopen('open');
    await Promise.resolve();
    expect(requests).toHaveLength(1);
  });

  test('catches up from zero when the workspace has no history', async () => {
    const mounted = mount(new QueryClient(), 0);
    mounted.reopen('open');
    await waitFor(() => expect(requests).toEqual(['/api/sync?since=0']));
  });

  test('catches up again on resume, from the highest applied sync id', async () => {
    const applied: SyncAction = {
      syncId: 9000,
      organizationId: 'o1',
      scopes: ['workspace:o1'],
      action: 'update',
      model: 'member',
      modelId: 'm1',
      data: {},
      actor: { type: 'user', id: 'u2' },
      at: new Date(0).toISOString(),
    };
    respond = (since) => ({ actions: [applied], truncated: false, syncId: since + 1 });
    const mounted = mount(new QueryClient(), 5000);
    mounted.reopen('open');
    await waitFor(() => expect(requests).toHaveLength(1));
    await waitFor(() => expect(requests).toHaveLength(1));

    resumeHandler?.();
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toBe('/api/sync?since=8000');
  });

  test('keeps paging while truncated', async () => {
    respond = (since) =>
      since === 4000
        ? { actions: [], truncated: true, syncId: 4500 }
        : { actions: [], truncated: false, syncId: 4600 };
    const mounted = mount(new QueryClient(), 5000);
    mounted.reopen('open');
    await waitFor(() => expect(requests).toEqual(['/api/sync?since=4000', '/api/sync?since=4500']));
  });

  test('refetches what is on screen when catch-up fails', async () => {
    respond = () => new Error('offline');
    const client = new QueryClient();
    const invalidate = mock(() => Promise.resolve());
    client.invalidateQueries = invalidate as unknown as typeof client.invalidateQueries;
    const mounted = mount(client, 100);
    mounted.reopen('open');
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  });
});
