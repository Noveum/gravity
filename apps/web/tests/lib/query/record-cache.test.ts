import { describe, expect, test } from 'bun:test';
import {
  containsCondition,
  emptyFilterGroup,
  encodeListQuery,
  replaceCondition,
} from '@gravity/shared/filters';
import type { PersonRow } from '@gravity/shared/records';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys.ts';
import { cachedLead } from '@/lib/query/lead-cache.ts';
import { placePerson } from '@/lib/query/record-cache.ts';
import type { Bootstrap, LeadPage, PersonPage } from '@/lib/query/schemas.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

function personFixture(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: 'per1',
    name: 'Ada Lovelace',
    emails: ['ada@acme.io'],
    primaryEmail: 'ada@acme.io',
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
    syncId: 5,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

const byName = (value: string) =>
  encodeListQuery({
    filter: replaceCondition(emptyFilterGroup(), containsCondition('name', value)),
    q: '',
  });
const leadsByPerson = (value: string) =>
  encodeListQuery({
    filter: replaceCondition(emptyFilterGroup(), containsCondition('person', value)),
    q: '',
  });

function client(): QueryClient {
  const created = new QueryClient();
  created.setQueryData(queryKeys.bootstrap, {
    me: { userId: 'u1', role: 'admin' },
    fields: [],
  } as unknown as Bootstrap);
  for (const search of [byName('ada'), byName('grace')]) {
    created.setQueryData(queryKeys.people(search), {
      pages: [{ people: search === byName('ada') ? [personFixture()] : [], nextCursor: null }],
      pageParams: [null],
    });
  }
  for (const search of [leadsByPerson('ada'), leadsByPerson('grace')]) {
    created.setQueryData(queryKeys.leads('p1', search), {
      pages: [{ leads: search === leadsByPerson('ada') ? [leadFixture()] : [], nextCursor: null }],
      pageParams: [null],
    });
  }
  return created;
}

function peopleIn(cache: QueryClient, search: string): string[] {
  const data = cache.getQueryData<{ pages: PersonPage[] }>(queryKeys.people(search));
  return (data?.pages ?? []).flatMap((page) => page.people.map((person) => person.name));
}

function leadsIn(cache: QueryClient, search: string): string[] {
  const data = cache.getQueryData<{ pages: LeadPage[] }>(queryKeys.leads('p1', search));
  return (data?.pages ?? []).flatMap((page) => page.leads.map((lead) => lead.personName));
}

describe('placePerson', () => {
  test('a rename moves the person and their leads between lists filtered by name', () => {
    const cache = client();
    placePerson(cache, personFixture({ name: 'Grace Hopper', syncId: 6 }));
    expect(peopleIn(cache, byName('ada'))).toEqual([]);
    expect(peopleIn(cache, byName('grace'))).toEqual(['Grace Hopper']);
    expect(leadsIn(cache, leadsByPerson('ada'))).toEqual([]);
    expect(leadsIn(cache, leadsByPerson('grace'))).toEqual(['Grace Hopper']);
    expect(cachedLead(cache, 'l1')?.personName).toBe('Grace Hopper');
  });

  test('an older person row is ignored', () => {
    const cache = client();
    placePerson(cache, personFixture({ name: 'Grace Hopper', syncId: 4 }));
    expect(peopleIn(cache, byName('ada'))).toEqual(['Ada Lovelace']);
    expect(leadsIn(cache, leadsByPerson('ada'))).toEqual(['Ada Lovelace']);
  });
});
