import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { clearLeadHistory, useLeadUndo } from '@/features/leads/lead-undo.ts';
import { useCommitLeadChange } from '@/features/leads/use-commit-lead-change.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

const realFetch = globalThis.fetch;
const sent: { url: string; body: unknown }[] = [];
let failing = false;

beforeEach(() => {
  sent.length = 0;
  failing = false;
  clearLeadHistory();
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { patch?: { stageId?: string } };
    sent.push({ url, body });
    if (failing) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'boom', message: 'Down' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    const lead = leadFixture({ stageId: body.patch?.stageId ?? 'new', syncId: 20 + sent.length });
    return Promise.resolve(
      new Response(JSON.stringify({ lead }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(queryKeys.bootstrap, bootstrapFixture());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return renderHook(() => ({ commit: useCommitLeadChange(), history: useLeadUndo() }), {
    wrapper,
  });
}

const toReady = { type: 'update', patch: { stageId: 'ready' } } as const;

describe('useCommitLeadChange', () => {
  test('a committed change is sent and lands on the undo stack', async () => {
    const hook = setup();
    act(() => hook.result.current.commit([leadFixture()], toReady, false));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: '/api/leads/l1', body: toReady });
    act(() => hook.result.current.history.undo());
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.body).toEqual({ type: 'update', patch: { stageId: 'new' } });
  });

  test('an announced change offers Undo in a toast, a quiet one does not', async () => {
    const hook = setup();
    act(() => hook.result.current.commit([leadFixture()], toReady, false));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByText('Moved YOD-1 to Ready')).not.toBeInTheDocument();
    act(() => hook.result.current.commit([leadFixture()], toReady, true));
    expect(await screen.findByText('Moved YOD-1 to Ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  test('a change the server refuses is dropped from the undo stack', async () => {
    failing = true;
    const hook = setup();
    act(() => hook.result.current.commit([leadFixture()], toReady, false));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    failing = false;
    act(() => hook.result.current.history.undo());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(sent).toHaveLength(1);
  });
});
