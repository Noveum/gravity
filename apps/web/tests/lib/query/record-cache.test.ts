import { describe, expect, test } from 'bun:test';
import {
  containsCondition,
  emptyFilterGroup,
  encodeListQuery,
  replaceCondition,
} from '@gravity/shared/filters';
import type { LeadRow } from '@gravity/shared/records';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys.ts';
import { cachedLead } from '@/lib/query/lead-cache.ts';
import type { Pages } from '@/lib/query/pages.ts';
import {
  applyEmployment,
  cachedPerson,
  placeCompany,
  placePerson,
  prependActivity,
} from '@/lib/query/record-cache.ts';
import type {
  CompanyPage,
  CompanyRecord,
  LeadPage,
  PersonPage,
  PersonRecord,
  TimelinePage,
} from '@/lib/query/schemas.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import {
  activityFixture,
  companyFixture,
  employmentFixture,
  personFixture,
} from '../../support/record-fixtures.ts';

const containing = (property: string, value: string) =>
  encodeListQuery({
    filter: replaceCondition(emptyFilterGroup(), containsCondition(property, value)),
    q: '',
  });

function pages<T>(page: T): Pages<T> {
  return { pages: [page], pageParams: [null] };
}

function emptyClient(): QueryClient {
  const created = new QueryClient();
  created.setQueryData(queryKeys.bootstrap, bootstrapFixture());
  return created;
}

function seedLeads(cache: QueryClient, search: string, leads: LeadRow[]): void {
  cache.setQueryData(queryKeys.leads('p1', search), pages({ leads, nextCursor: null }));
}

function leadsIn(cache: QueryClient, search: string): string[] {
  const data = cache.getQueryData<Pages<LeadPage>>(queryKeys.leads('p1', search));
  return (data?.pages ?? []).flatMap((page) => page.leads.map((lead) => lead.id));
}

function peopleIn(cache: QueryClient, search: string): string[] {
  const data = cache.getQueryData<Pages<PersonPage>>(queryKeys.people(search));
  return (data?.pages ?? []).flatMap((page) => page.people.map((person) => person.name));
}

function companiesIn(cache: QueryClient, search: string): string[] {
  const data = cache.getQueryData<Pages<CompanyPage>>(queryKeys.companies(search));
  return (data?.pages ?? []).flatMap((page) => page.companies.map((company) => company.name));
}

function personRecord(overrides: Partial<PersonRecord> = {}): PersonRecord {
  return { person: personFixture(), employments: [], leads: [], ...overrides };
}

function companyRecord(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return { company: companyFixture(), people: [], leads: [], ...overrides };
}

describe('placePerson', () => {
  function client(): QueryClient {
    const created = emptyClient();
    created.setQueryData(
      queryKeys.people(containing('name', 'ada')),
      pages({ people: [personFixture()], nextCursor: null }),
    );
    created.setQueryData(
      queryKeys.people(containing('name', 'grace')),
      pages({ people: [], nextCursor: null }),
    );
    seedLeads(created, containing('person', 'ada'), [leadFixture()]);
    seedLeads(created, containing('person', 'grace'), []);
    return created;
  }

  test('a rename moves the person and their leads between lists filtered by name', () => {
    const cache = client();
    placePerson(cache, personFixture({ name: 'Grace Hopper', syncId: 6 }));
    expect(peopleIn(cache, containing('name', 'ada'))).toEqual([]);
    expect(peopleIn(cache, containing('name', 'grace'))).toEqual(['Grace Hopper']);
    expect(leadsIn(cache, containing('person', 'ada'))).toEqual([]);
    expect(leadsIn(cache, containing('person', 'grace'))).toEqual(['l1']);
    expect(cachedLead(cache, 'l1')?.personName).toBe('Grace Hopper');
  });

  test('an older person row is ignored', () => {
    const cache = client();
    placePerson(cache, personFixture({ name: 'Grace Hopper', syncId: 4 }));
    expect(peopleIn(cache, containing('name', 'ada'))).toEqual(['Ada Lovelace']);
    expect(leadsIn(cache, containing('person', 'ada'))).toEqual(['l1']);
  });

  test('a person held only inside a company record keeps its newer copy', () => {
    const cache = emptyClient();
    const embedded = personFixture({ name: 'Ada King', syncId: 30 });
    cache.setQueryData(
      queryKeys.company('c1'),
      companyRecord({
        people: [{ person: embedded, employment: employmentFixture() }],
        leads: [leadFixture({ personName: 'Ada King', companyId: 'c1' })],
      }),
    );
    placePerson(cache, personFixture({ name: 'Ada Lovelace', syncId: 25 }));
    const record = cache.getQueryData<CompanyRecord>(queryKeys.company('c1'));
    expect(record?.people[0]?.person.syncId).toBe(30);
    expect(record?.people[0]?.person.name).toBe('Ada King');
    expect(record?.leads[0]?.personName).toBe('Ada King');
    expect(cachedPerson(cache, 'per1')?.syncId).toBe(30);
  });
});

describe('placeCompany', () => {
  function client(): QueryClient {
    const created = emptyClient();
    created.setQueryData(
      queryKeys.companies(containing('name', 'acme')),
      pages({ companies: [companyFixture()], nextCursor: null }),
    );
    created.setQueryData(
      queryKeys.companies(containing('name', 'globex')),
      pages({ companies: [], nextCursor: null }),
    );
    created.setQueryData(queryKeys.company('c1'), companyRecord());
    seedLeads(created, containing('company', 'acme'), [
      leadFixture({ companyId: 'c1', companyName: 'Acme' }),
    ]);
    seedLeads(created, containing('company', 'globex'), []);
    return created;
  }

  test('a rename moves the company and its leads between lists filtered by name', () => {
    const cache = client();
    placeCompany(cache, companyFixture({ name: 'Globex', syncId: 6 }));
    expect(companiesIn(cache, containing('name', 'acme'))).toEqual([]);
    expect(companiesIn(cache, containing('name', 'globex'))).toEqual(['Globex']);
    expect(cache.getQueryData<CompanyRecord>(queryKeys.company('c1'))?.company.name).toBe('Globex');
    expect(leadsIn(cache, containing('company', 'acme'))).toEqual([]);
    expect(leadsIn(cache, containing('company', 'globex'))).toEqual(['l1']);
  });

  test('an older company row is ignored everywhere', () => {
    const cache = client();
    placeCompany(cache, companyFixture({ name: 'Globex', syncId: 4 }));
    expect(companiesIn(cache, containing('name', 'acme'))).toEqual(['Acme']);
    expect(cache.getQueryData<CompanyRecord>(queryKeys.company('c1'))?.company.name).toBe('Acme');
    expect(leadsIn(cache, containing('company', 'acme'))).toEqual(['l1']);
  });
});

describe('applyEmployment', () => {
  const everything = encodeListQuery({ filter: emptyFilterGroup(), q: '' });

  function client(): QueryClient {
    const created = emptyClient();
    created.setQueryData(
      queryKeys.person('per1'),
      personRecord({
        person: personFixture({ companyId: 'c1', companyName: 'Acme', title: 'Engineer' }),
        employments: [employmentFixture()],
      }),
    );
    seedLeads(created, everything, [leadFixture({ companyId: 'c1', companyName: 'Acme' })]);
    return created;
  }

  test('a new current job moves the person and their leads to the new company', () => {
    const cache = client();
    applyEmployment(
      cache,
      employmentFixture({
        id: 'e2',
        companyId: 'c2',
        companyName: 'Globex',
        title: 'CTO',
        syncId: 31,
      }),
    );
    const record = cache.getQueryData<PersonRecord>(queryKeys.person('per1'));
    expect(record?.person.companyName).toBe('Globex');
    expect(record?.person.title).toBe('CTO');
    expect(record?.employments.map((job) => job.id)).toEqual(['e2', 'e1']);
    expect(cachedLead(cache, 'l1')?.companyId).toBe('c2');
    expect(cachedLead(cache, 'l1')?.companyName).toBe('Globex');
  });

  test('ending the current job clears the company from the leads', () => {
    const cache = client();
    applyEmployment(cache, employmentFixture({ isCurrent: false, syncId: 31 }));
    expect(cachedLead(cache, 'l1')?.companyId).toBeNull();
    expect(cachedLead(cache, 'l1')?.companyName).toBeNull();
  });

  test('an employment older than the cached copy changes nothing', () => {
    const cache = client();
    applyEmployment(cache, employmentFixture({ isCurrent: false, title: 'Intern', syncId: 25 }));
    const record = cache.getQueryData<PersonRecord>(queryKeys.person('per1'));
    expect(record?.employments).toEqual([employmentFixture()]);
    expect(cachedLead(cache, 'l1')?.companyId).toBe('c1');
  });

  test('an employment held only inside a company record keeps its newer copy', () => {
    const cache = emptyClient();
    cache.setQueryData(
      queryKeys.company('c1'),
      companyRecord({ people: [{ person: personFixture(), employment: employmentFixture() }] }),
    );
    seedLeads(cache, everything, [leadFixture({ companyId: 'c1', companyName: 'Acme' })]);
    applyEmployment(cache, employmentFixture({ isCurrent: false, syncId: 25 }));
    const record = cache.getQueryData<CompanyRecord>(queryKeys.company('c1'));
    expect(record?.people.map((entry) => entry.employment.syncId)).toEqual([30]);
    expect(cachedLead(cache, 'l1')?.companyId).toBe('c1');
  });
});

describe('prependActivity', () => {
  function timeline(cache: QueryClient, subjectId: string, filter: 'all' | 'notes'): string[] {
    const data = cache.getQueryData<Pages<TimelinePage>>(
      queryKeys.timeline('lead', subjectId, filter),
    );
    return (data?.pages ?? []).flatMap((page) => page.activities.map((activity) => activity.id));
  }

  function client(): QueryClient {
    const created = emptyClient();
    const older = activityFixture({ id: 'a0', syncId: 39 });
    for (const [subjectId, filter] of [
      ['l1', 'all'],
      ['l1', 'notes'],
      ['l2', 'all'],
    ] as const) {
      created.setQueryData(
        queryKeys.timeline('lead', subjectId, filter),
        pages({
          activities: subjectId === 'l1' && filter === 'all' ? [older] : [],
          nextCursor: null,
        }),
      );
    }
    return created;
  }

  test('prepends to timelines of a linked subject whose filter matches the kind', () => {
    const cache = client();
    prependActivity(cache, activityFixture());
    expect(timeline(cache, 'l1', 'all')).toEqual(['a1', 'a0']);
    expect(timeline(cache, 'l1', 'notes')).toEqual([]);
    expect(timeline(cache, 'l2', 'all')).toEqual([]);
  });

  test('never adds the same activity twice', () => {
    const cache = client();
    prependActivity(cache, activityFixture());
    prependActivity(cache, activityFixture());
    expect(timeline(cache, 'l1', 'all')).toEqual(['a1', 'a0']);
  });
});
