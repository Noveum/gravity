import { describe, expect, test } from 'bun:test';
import {
  emptyFilterGroup,
  encodeListQuery,
  inCondition,
  replaceCondition,
} from '@gravity/shared/filters';
import type { LeadRow } from '@gravity/shared/records';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys.ts';
import { cachedLead, placeLead, removeLead } from '@/lib/query/lead-cache.ts';
import type { Bootstrap, LeadPage } from '@/lib/query/schemas.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

function seed(client: QueryClient, pipelineId: string, search: string, leads: LeadRow[]): void {
  client.setQueryData(queryKeys.leads(pipelineId, search), {
    pages: [{ leads, nextCursor: null }],
    pageParams: [null],
  });
}

function idsIn(client: QueryClient, pipelineId: string, search: string): string[] {
  const data = client.getQueryData<{ pages: LeadPage[] }>(queryKeys.leads(pipelineId, search));
  return (data?.pages ?? []).flatMap((page) => page.leads.map((lead) => lead.id));
}

const bootstrap = { me: { userId: 'u1', role: 'admin' }, fields: [] } as unknown as Bootstrap;
const everything = encodeListQuery({ filter: emptyFilterGroup(), q: '' });
const newOnly = encodeListQuery({
  filter: replaceCondition(emptyFilterGroup(), inCondition('stage', ['new'])),
  q: '',
});
const readyOnly = encodeListQuery({
  filter: replaceCondition(emptyFilterGroup(), inCondition('stage', ['ready'])),
  q: '',
});

function client(): QueryClient {
  const created = new QueryClient();
  created.setQueryData(queryKeys.bootstrap, bootstrap);
  return created;
}

describe('placeLead', () => {
  test('a stage change leaves the list filtered to the old stage and joins the new one', () => {
    const cache = client();
    seed(cache, 'p1', everything, [leadFixture()]);
    seed(cache, 'p1', newOnly, [leadFixture()]);
    seed(cache, 'p1', readyOnly, []);
    placeLead(cache, leadFixture({ stageId: 'ready', syncId: 11 }));
    expect(idsIn(cache, 'p1', everything)).toEqual(['l1']);
    expect(idsIn(cache, 'p1', newOnly)).toEqual([]);
    expect(idsIn(cache, 'p1', readyOnly)).toEqual(['l1']);
  });

  test('never joins another pipeline and leaves when archived', () => {
    const cache = client();
    seed(cache, 'p2', everything, []);
    seed(cache, 'p1', everything, [leadFixture()]);
    placeLead(cache, leadFixture({ syncId: 11, archivedAt: '2026-10-02T00:00:00.000Z' }));
    expect(idsIn(cache, 'p2', everything)).toEqual([]);
    expect(idsIn(cache, 'p1', everything)).toEqual([]);
  });

  test('an older row never replaces a newer one', () => {
    const cache = client();
    seed(cache, 'p1', everything, [leadFixture({ syncId: 20, priority: 1 })]);
    placeLead(cache, leadFixture({ syncId: 19, priority: 4 }));
    expect(cachedLead(cache, 'l1')?.priority).toBe(1);
  });

  test('removeLead drops the row from every list', () => {
    const cache = client();
    seed(cache, 'p1', everything, [leadFixture()]);
    seed(cache, 'p1', newOnly, [leadFixture()]);
    removeLead(cache, 'l1');
    expect([...idsIn(cache, 'p1', everything), ...idsIn(cache, 'p1', newOnly)]).toEqual([]);
  });
});
