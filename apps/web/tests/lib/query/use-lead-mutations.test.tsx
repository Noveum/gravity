import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { emptyFilterGroup, encodeListQuery } from '@gravity/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { queryKeys } from '@/lib/query/keys.ts';
import { cachedLead } from '@/lib/query/lead-cache.ts';
import type { Bootstrap, PersonPage } from '@/lib/query/schemas.ts';
import { useChangeLeads, useQuickCreateLead } from '@/lib/query/use-lead-mutations.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

interface SentRequest {
  readonly path: string;
  readonly method: string | undefined;
  readonly body: unknown;
}

const realFetch = globalThis.fetch;
const sent: SentRequest[] = [];
const waiting: ((response: Response) => void)[] = [];

beforeEach(() => {
  sent.length = 0;
  waiting.length = 0;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ path: String(input), method: init?.method, body });
    return new Promise<Response>((resolve) => {
      waiting.push(resolve);
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(status: number, body: unknown): void {
  const next = waiting.shift();
  if (next === undefined) throw new Error('No request is waiting for an answer.');
  next(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function seededClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(queryKeys.bootstrap, {
    me: { userId: 'u1', role: 'admin' },
    fields: [],
    stages: [
      {
        id: 'new',
        pipelineId: 'p1',
        name: 'New',
        category: 'open',
        sortOrder: 0,
        syncId: 1,
        archivedAt: null,
      },
      {
        id: 'ready',
        pipelineId: 'p1',
        name: 'Ready',
        category: 'open',
        sortOrder: 1,
        syncId: 1,
        archivedAt: null,
      },
    ],
  } as unknown as Bootstrap);
  client.setQueryData(
    queryKeys.leads('p1', encodeListQuery({ filter: emptyFilterGroup(), q: '' })),
    {
      pages: [{ leads: [leadFixture()], nextCursor: null }],
      pageParams: [null],
    },
  );
  return client;
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function setup() {
  const client = seededClient();
  return { client, ...renderHook(() => useChangeLeads(), { wrapper: wrapperFor(client) }) };
}

function setupQuickCreate() {
  const client = seededClient();
  client.setQueryData(queryKeys.people(''), {
    pages: [{ people: [], nextCursor: null }],
    pageParams: [null],
  });
  return { client, ...renderHook(() => useQuickCreateLead(), { wrapper: wrapperFor(client) }) };
}

const preview = leadFixture({
  id: 'l2',
  key: 'YOD-2',
  number: 2,
  personId: 'per2',
  personName: 'Grace Hopper',
  syncId: 0,
});

const quickBody = {
  leadId: 'l2',
  pipelineId: 'p1',
  person: { name: 'Grace Hopper' },
};

const grace = {
  id: 'per2',
  name: 'Grace Hopper',
  emails: [],
  primaryEmail: null,
  phones: [],
  linkedinUrl: null,
  linkedinProviderId: null,
  location: null,
  timezone: null,
  doNotContact: false,
  fields: {},
  companyId: null,
  companyName: null,
  title: null,
  syncId: 20,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  archivedAt: null,
};

function cachedPeople(client: QueryClient): string[] {
  const data = client.getQueryData<{ pages: PersonPage[] }>(queryKeys.people(''));
  return (data?.pages ?? []).flatMap((page) => page.people.map((person) => person.id));
}

const toReady = { type: 'update', patch: { stageId: 'ready' } } as const;

describe('useChangeLeads', () => {
  test('applies the change while the request is pending and keeps the server row', async () => {
    const { client, result } = setup();
    act(() => {
      result.current.mutate({ leads: [leadFixture()], change: toReady });
    });
    await waitFor(() => expect(cachedLead(client, 'l1')?.stageId).toBe('ready'));
    await waitFor(() => expect(waiting).toHaveLength(1));
    expect(sent).toEqual([{ path: '/api/leads/l1', method: 'PATCH', body: toReady }]);
    expect(cachedLead(client, 'l1')?.syncId).toBe(10);
    answer(200, { lead: leadFixture({ stageId: 'ready', syncId: 11 }) });
    await waitFor(() => expect(cachedLead(client, 'l1')?.syncId).toBe(11));
    expect(cachedLead(client, 'l1')?.stageId).toBe('ready');
  });

  test('rolls back after the server refuses and Retry sends the change again', async () => {
    const { client, result } = setup();
    act(() => {
      result.current.mutate({ leads: [leadFixture()], change: toReady });
    });
    await waitFor(() => expect(cachedLead(client, 'l1')?.stageId).toBe('ready'));
    await waitFor(() => expect(waiting).toHaveLength(1));
    answer(409, {
      error: {
        code: 'conflict',
        message: 'Ada Lovelace already has an open lead in this pipeline: YOD-2.',
      },
    });
    await waitFor(() => expect(cachedLead(client, 'l1')?.stageId).toBe('new'));
    expect(await screen.findByText('Could not update YOD-1')).toBeInTheDocument();
    expect(
      screen.getByText('Ada Lovelace already has an open lead in this pipeline: YOD-2.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(cachedLead(client, 'l1')?.stageId).toBe('ready'));
    await waitFor(() => expect(waiting).toHaveLength(1));
    expect(sent).toHaveLength(2);
    answer(200, { lead: leadFixture({ stageId: 'ready', syncId: 12 }) });
    await waitFor(() => expect(cachedLead(client, 'l1')?.syncId).toBe(12));
  });
});

describe('useQuickCreateLead', () => {
  test('shows the preview at once, then keeps the server lead and person', async () => {
    const { client, result } = setupQuickCreate();
    act(() => {
      result.current.mutate({ body: quickBody, preview });
    });
    await waitFor(() => expect(cachedLead(client, 'l2')?.personName).toBe('Grace Hopper'));
    await waitFor(() => expect(waiting).toHaveLength(1));
    expect(sent).toEqual([{ path: '/api/leads/quick', method: 'POST', body: quickBody }]);
    answer(200, {
      lead: { ...preview, syncId: 21 },
      person: grace,
      company: null,
      personCreated: true,
    });
    await waitFor(() => expect(cachedLead(client, 'l2')?.syncId).toBe(21));
    expect(cachedPeople(client)).toEqual(['per2']);
  });

  test('removes the preview when the server refuses and offers Retry', async () => {
    const { client, result } = setupQuickCreate();
    act(() => {
      result.current.mutate({ body: quickBody, preview });
    });
    await waitFor(() => expect(cachedLead(client, 'l2')).toBeDefined());
    await waitFor(() => expect(waiting).toHaveLength(1));
    answer(409, { error: { code: 'conflict', message: 'That id is already in use.' } });
    await waitFor(() => expect(cachedLead(client, 'l2')).toBeUndefined());
    expect(await screen.findByText('Could not add Grace Hopper')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(cachedLead(client, 'l1')?.stageId).toBe('new');
  });
});
