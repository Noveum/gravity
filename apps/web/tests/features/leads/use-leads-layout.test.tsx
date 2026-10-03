import { afterEach, describe, expect, mock, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { useLeadsLayout } from '@/features/leads/use-leads-layout.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Bootstrap } from '@/lib/query/schemas.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Sent {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: unknown;
}

function deferredServer() {
  const sent: Sent[] = [];
  const pending: (() => void)[] = [];
  globalThis.fetch = mock((url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ url, method: init.method, body });
    return new Promise<Response>((resolve) => {
      pending.push(() =>
        resolve(
          new Response(JSON.stringify({ preference: body }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
    });
  }) as unknown as typeof fetch;
  return { sent, pending };
}

function setup(bootstrap: Bootstrap = bootstrapFixture()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(queryKeys.bootstrap, bootstrap);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useLeadsLayout('p1'), { wrapper });
  return { client, hook };
}

describe('useLeadsLayout', () => {
  test('toggles between list and board and saves the choice for this pipeline', async () => {
    const server = deferredServer();
    const { client, hook } = setup();
    expect(hook.result.current.layout).toBe('list');
    act(() => hook.result.current.toggle());
    expect(hook.result.current.layout).toBe('board');
    await waitFor(() => expect(server.sent).toHaveLength(1));
    expect(server.sent[0]).toEqual({
      url: '/api/view-preferences',
      method: 'PUT',
      body: { page: 'leads', scope: 'p1', layout: 'board', display: {} },
    });
    act(() => server.pending.shift()?.());
    await waitFor(() =>
      expect(client.getQueryData<Bootstrap>(queryKeys.bootstrap)?.viewPreferences).toEqual([
        { page: 'leads', scope: 'p1', layout: 'board', display: {} },
      ]),
    );
    expect(hook.result.current.layout).toBe('board');
  });

  test('reads a saved board layout and leaves other pipelines alone', () => {
    deferredServer();
    const { hook } = setup(
      bootstrapFixture({
        viewPreferences: [
          { page: 'leads', scope: 'p1', layout: 'board', display: {} },
          { page: 'leads', scope: 'p2', layout: 'list', display: {} },
        ],
      }),
    );
    expect(hook.result.current.layout).toBe('board');
  });

  test('a late answer to an earlier toggle does not undo a later one', async () => {
    const server = deferredServer();
    const { hook } = setup();
    act(() => hook.result.current.toggle());
    act(() => hook.result.current.toggle());
    expect(hook.result.current.layout).toBe('list');
    await waitFor(() => expect(server.sent).toHaveLength(2));
    act(() => server.pending.shift()?.());
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.layout).toBe('list');
    act(() => server.pending.shift()?.());
    await waitFor(() => expect(hook.result.current.layout).toBe('list'));
  });
});
