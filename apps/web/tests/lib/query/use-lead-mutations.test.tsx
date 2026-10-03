import { describe, expect, test } from 'bun:test';
import type { SyncAction } from '@gravity/shared/events';
import { emptyFilterGroup, encodeListQuery } from '@gravity/shared/filters';
import type { LeadRow } from '@gravity/shared/records';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clientId } from '@/lib/query/client-id.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { cachedLead } from '@/lib/query/lead-cache.ts';
import type { PersonPage } from '@/lib/query/schemas.ts';
import { useChangeLeads, useQuickCreateLead } from '@/lib/query/use-lead-mutations.ts';
import { registerCrmDeltaHandlers } from '@/lib/realtime/crm-deltas.tsx';
import { applyDelta } from '@/lib/realtime/delta-bridge.tsx';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { installDeferredFetch } from '../../support/deferred-fetch.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mutationClient, wrapperFor } from '../../support/query-wrapper.tsx';
import { personFixture } from '../../support/record-fixtures.ts';

const server = installDeferredFetch();

const everything = encodeListQuery({ filter: emptyFilterGroup(), q: '' });

function seededClient(leads: LeadRow[] = [leadFixture()]): QueryClient {
  const client = mutationClient();
  client.setQueryData(queryKeys.bootstrap, bootstrapFixture());
  client.setQueryData(queryKeys.leads('p1', everything), {
    pages: [{ leads, nextCursor: null }],
    pageParams: [null],
  });
  return client;
}

function setup(leads?: LeadRow[]) {
  const client = seededClient(leads);
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

const toReady = { type: 'update', patch: { stageId: 'ready' } } as const;
const second = leadFixture({ id: 'l2', key: 'YOD-2', number: 2, personId: 'per2' });

const preview = leadFixture({
  id: 'l3',
  key: 'YOD-3',
  number: 3,
  personId: 'per2',
  personName: 'Grace Hopper',
  syncId: 0,
});

const quickBody = { leadId: 'l3', pipelineId: 'p1', person: { name: 'Grace Hopper' } };

function cachedPeople(client: QueryClient): string[] {
  const data = client.getQueryData<{ pages: PersonPage[] }>(queryKeys.people(''));
  return (data?.pages ?? []).flatMap((page) => page.people.map((person) => person.id));
}

function echo(lead: LeadRow): SyncAction {
  return {
    syncId: lead.syncId,
    organizationId: 'o1',
    scopes: ['workspace:o1'],
    action: 'update',
    model: 'lead',
    modelId: lead.id,
    data: lead,
    actor: { type: 'user', id: 'u1' },
    at: new Date(0).toISOString(),
    originClientId: clientId(),
  };
}

describe('late echoes of answered changes', () => {
  test('the optimistic second edit survives the late echo of the first', async () => {
    const unregister = registerCrmDeltaHandlers();
    try {
      const { client, result } = setup();
      const firstAnswer = leadFixture({ priority: 1, syncId: 11 });
      act(() => {
        result.current.mutate({
          leads: [leadFixture()],
          change: { type: 'update', patch: { priority: 1 } },
        });
      });
      await waitFor(() => expect(server.waiting()).toBe(1));
      server.answer(200, { lead: firstAnswer });
      await waitFor(() => expect(cachedLead(client, 'l1')?.syncId).toBe(11));
      act(() => {
        result.current.mutate({
          leads: [firstAnswer],
          change: { type: 'update', patch: { priority: 2 } },
        });
      });
      await waitFor(() => expect(cachedLead(client, 'l1')?.priority).toBe(2));
      expect(cachedLead(client, 'l1')?.syncId).toBe(11);
      applyDelta(echo(firstAnswer), client);
      expect(cachedLead(client, 'l1')?.priority).toBe(2);
      await waitFor(() => expect(server.waiting()).toBe(1));
      server.answer(200, { lead: leadFixture({ priority: 2, syncId: 12 }) });
      await waitFor(() => expect(cachedLead(client, 'l1')?.syncId).toBe(12));
      expect(cachedLead(client, 'l1')?.priority).toBe(2);
    } finally {
      unregister();
    }
  });

  test('quick create records the lead, person and company it was answered with', async () => {
    const unregister = registerCrmDeltaHandlers();
    try {
      const { client, result } = setupQuickCreate();
      act(() => {
        result.current.mutate({ body: quickBody, preview });
      });
      await waitFor(() => expect(server.waiting()).toBe(1));
      const created = leadFixture({ ...preview, syncId: 31 });
      server.answer(200, {
        lead: created,
        person: personFixture({ id: 'per2', name: 'Grace Hopper', syncId: 30 }),
        company: null,
        personCreated: true,
      });
      await waitFor(() => expect(cachedLead(client, 'l3')?.syncId).toBe(31));
      applyDelta(echo({ ...created, priority: 4 }), client);
      expect(cachedLead(client, 'l3')?.priority).toBe(0);
    } finally {
      unregister();
    }
  });
});

describe('useChangeLeads', () => {
  test('applies the change while the request is pending and keeps the server row', async () => {
    const { client, result } = setup();
    act(() => {
      result.current.mutate({ leads: [leadFixture()], change: toReady });
    });
    await waitFor(() => expect(cachedLead(client, 'l1')?.stageId).toBe('ready'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toEqual([{ path: '/api/leads/l1', method: 'PATCH', body: toReady }]);
    expect(cachedLead(client, 'l1')?.syncId).toBe(10);
    server.answer(200, { lead: leadFixture({ stageId: 'ready', syncId: 11 }) });
    await waitFor(() => expect(cachedLead(client, 'l1')?.syncId).toBe(11));
    expect(cachedLead(client, 'l1')?.stageId).toBe('ready');
  });

  test('rolls back after the server refuses and Retry sends the change again', async () => {
    const { client, result } = setup();
    act(() => {
      result.current.mutate({ leads: [leadFixture()], change: toReady });
    });
    await waitFor(() => expect(cachedLead(client, 'l1')?.stageId).toBe('ready'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    server.answer(409, {
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
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toHaveLength(2);
    server.answer(200, { lead: leadFixture({ stageId: 'ready', syncId: 12 }) });
    await waitFor(() => expect(cachedLead(client, 'l1')?.syncId).toBe(12));
  });

  test('sends several leads to the bulk route and keeps every server row', async () => {
    const { client, result } = setup([leadFixture(), second]);
    act(() => {
      result.current.mutate({ leads: [leadFixture(), second], change: toReady });
    });
    await waitFor(() => expect(cachedLead(client, 'l2')?.stageId).toBe('ready'));
    expect(cachedLead(client, 'l1')?.stageId).toBe('ready');
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toEqual([
      {
        path: '/api/leads/bulk',
        method: 'POST',
        body: { leadIds: ['l1', 'l2'], change: toReady },
      },
    ]);
    server.answer(200, {
      leads: [
        leadFixture({ stageId: 'ready', syncId: 11 }),
        { ...second, stageId: 'ready', syncId: 12 },
      ],
    });
    await waitFor(() => expect(cachedLead(client, 'l2')?.syncId).toBe(12));
    expect(cachedLead(client, 'l1')?.syncId).toBe(11);
  });

  test('rolls every lead of a refused bulk change back and names how many failed', async () => {
    const { client, result } = setup([leadFixture(), second]);
    act(() => {
      result.current.mutate({ leads: [leadFixture(), second], change: toReady });
    });
    await waitFor(() => expect(cachedLead(client, 'l2')?.stageId).toBe('ready'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    server.answer(403, { error: { code: 'forbidden', message: 'Your role cannot record write.' } });
    await waitFor(() => expect(cachedLead(client, 'l2')?.stageId).toBe('new'));
    expect(cachedLead(client, 'l1')?.stageId).toBe('new');
    expect(await screen.findByText('Could not update 2 leads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('useQuickCreateLead', () => {
  test('shows the preview at once, then keeps the server lead and person', async () => {
    const { client, result } = setupQuickCreate();
    act(() => {
      result.current.mutate({ body: quickBody, preview });
    });
    await waitFor(() => expect(cachedLead(client, 'l3')?.personName).toBe('Grace Hopper'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toEqual([{ path: '/api/leads/quick', method: 'POST', body: quickBody }]);
    server.answer(200, {
      lead: { ...preview, syncId: 21 },
      person: personFixture({ id: 'per2', name: 'Grace Hopper', syncId: 20 }),
      company: null,
      personCreated: true,
    });
    await waitFor(() => expect(cachedLead(client, 'l3')?.syncId).toBe(21));
    expect(cachedPeople(client)).toEqual(['per2']);
  });

  test('removes the preview when the server refuses and offers Retry', async () => {
    const { client, result } = setupQuickCreate();
    act(() => {
      result.current.mutate({ body: quickBody, preview });
    });
    await waitFor(() => expect(cachedLead(client, 'l3')).toBeDefined());
    await waitFor(() => expect(server.waiting()).toBe(1));
    server.answer(409, { error: { code: 'conflict', message: 'That id is already in use.' } });
    await waitFor(() => expect(cachedLead(client, 'l3')).toBeUndefined());
    expect(await screen.findByText('Could not add Grace Hopper')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(cachedLead(client, 'l1')?.stageId).toBe('new');
  });
});
