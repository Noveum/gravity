import { describe, expect, test } from 'bun:test';
import { emptyFilterGroup, encodeListQuery } from '@gravity/shared/filters';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '@/lib/query/keys.ts';
import { cachedLead } from '@/lib/query/lead-cache.ts';
import { cachedCompany, cachedPerson } from '@/lib/query/record-cache.ts';
import { useUpdateCompany, useUpdatePerson } from '@/lib/query/use-record-mutations.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { installDeferredFetch } from '../../support/deferred-fetch.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mutationClient, wrapperFor } from '../../support/query-wrapper.tsx';
import { companyFixture, personFixture } from '../../support/record-fixtures.ts';

const server = installDeferredFetch();

const everything = encodeListQuery({ filter: emptyFilterGroup(), q: '' });

function seededClient(): QueryClient {
  const client = mutationClient();
  client.setQueryData(queryKeys.bootstrap, bootstrapFixture());
  client.setQueryData(queryKeys.people(everything), {
    pages: [{ people: [personFixture()], nextCursor: null }],
    pageParams: [null],
  });
  client.setQueryData(queryKeys.companies(everything), {
    pages: [{ companies: [companyFixture()], nextCursor: null }],
    pageParams: [null],
  });
  client.setQueryData(queryKeys.leads('p1', everything), {
    pages: [{ leads: [leadFixture({ companyId: 'c1', companyName: 'Acme' })], nextCursor: null }],
    pageParams: [null],
  });
  return client;
}

const staleCaller = personFixture({ name: 'Ada Lovelace', location: 'Old copy', syncId: 4 });

describe('useUpdatePerson', () => {
  function setup() {
    const client = seededClient();
    return { client, ...renderHook(() => useUpdatePerson(), { wrapper: wrapperFor(client) }) };
  }

  test('renames the person and their leads while pending and keeps the server row', async () => {
    const { client, result } = setup();
    act(() => {
      result.current.mutate({ person: staleCaller, patch: { name: 'Ada King' } });
    });
    await waitFor(() => expect(cachedPerson(client, 'per1')?.name).toBe('Ada King'));
    expect(cachedLead(client, 'l1')?.personName).toBe('Ada King');
    expect(cachedPerson(client, 'per1')?.location).toBeNull();
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toEqual([
      { path: '/api/people/per1', method: 'PATCH', body: { name: 'Ada King' } },
    ]);
    server.answer(200, { person: personFixture({ name: 'Ada King', syncId: 6 }) });
    await waitFor(() => expect(cachedPerson(client, 'per1')?.syncId).toBe(6));
  });

  test('rolls back to the cached person, not the caller copy, and Retry resends', async () => {
    const { client, result } = setup();
    act(() => {
      result.current.mutate({ person: staleCaller, patch: { name: 'Ada King' } });
    });
    await waitFor(() => expect(cachedPerson(client, 'per1')?.name).toBe('Ada King'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    server.answer(422, { error: { code: 'validation_failed', message: 'Give it a name.' } });
    await waitFor(() => expect(cachedPerson(client, 'per1')?.name).toBe('Ada Lovelace'));
    expect(cachedPerson(client, 'per1')?.location).toBeNull();
    expect(cachedLead(client, 'l1')?.personName).toBe('Ada Lovelace');
    expect(await screen.findByText('Could not update Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Give it a name.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(cachedPerson(client, 'per1')?.name).toBe('Ada King'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toHaveLength(2);
  });
});

describe('useUpdateCompany', () => {
  function setup() {
    const client = seededClient();
    return { client, ...renderHook(() => useUpdateCompany(), { wrapper: wrapperFor(client) }) };
  }

  const staleCompany = companyFixture({ segment: 'Old copy', syncId: 4 });

  test('renames the company on its leads while pending and keeps the server row', async () => {
    const { client, result } = setup();
    act(() => {
      result.current.mutate({ company: staleCompany, patch: { name: 'Acme Labs' } });
    });
    await waitFor(() => expect(cachedCompany(client, 'c1')?.name).toBe('Acme Labs'));
    expect(cachedLead(client, 'l1')?.companyName).toBe('Acme Labs');
    expect(cachedCompany(client, 'c1')?.segment).toBeNull();
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toEqual([
      { path: '/api/companies/c1', method: 'PATCH', body: { name: 'Acme Labs' } },
    ]);
    server.answer(200, { company: companyFixture({ name: 'Acme Labs', syncId: 6 }) });
    await waitFor(() => expect(cachedCompany(client, 'c1')?.syncId).toBe(6));
  });

  test('rolls back to the cached company after a refusal and Retry resends', async () => {
    const { client, result } = setup();
    act(() => {
      result.current.mutate({ company: staleCompany, patch: { name: 'Acme Labs' } });
    });
    await waitFor(() => expect(cachedCompany(client, 'c1')?.name).toBe('Acme Labs'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    server.answer(403, { error: { code: 'forbidden', message: 'Your role cannot record write.' } });
    await waitFor(() => expect(cachedCompany(client, 'c1')?.name).toBe('Acme'));
    expect(cachedCompany(client, 'c1')?.segment).toBeNull();
    expect(cachedLead(client, 'l1')?.companyName).toBe('Acme');
    expect(await screen.findByText('Could not update Acme')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(cachedCompany(client, 'c1')?.name).toBe('Acme Labs'));
    await waitFor(() => expect(server.waiting()).toBe(1));
    expect(server.sent).toHaveLength(2);
  });
});
