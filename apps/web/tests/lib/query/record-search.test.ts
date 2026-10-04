import { describe, expect, test } from 'bun:test';
import { emptyFilterGroup, encodeListQuery } from '@gravity/shared/filters';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys.ts';
import {
  EMPTY_HITS,
  matchCachedPeople,
  mergeHits,
  personHitOf,
  searchCachedRecords,
} from '@/lib/query/record-search.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { companyFixture, employmentFixture, personFixture } from '../../support/record-fixtures.ts';

const listQuery = encodeListQuery({ filter: emptyFilterGroup(), q: '' });

function seeded(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(queryKeys.leads('p1', listQuery), {
    pages: [
      {
        leads: [
          leadFixture({
            id: 'l1',
            key: 'YOD-1',
            personId: 'per1',
            personName: 'Ada Lovelace',
            personEmail: 'ada@acme.io',
            personLinkedinUrl: 'https://www.linkedin.com/in/ada',
          }),
          leadFixture({
            id: 'l12',
            key: 'YOD-12',
            personId: 'per2',
            personName: 'Grace Hopper',
            personEmail: 'grace@navy.mil',
          }),
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  });
  return client;
}

describe('searchCachedRecords', () => {
  test('finds people from cached lead rows and leads by key', () => {
    const hits = searchCachedRecords(seeded(), 'acme');
    expect(hits.people.map((person) => person.name)).toEqual(['Ada Lovelace']);
    expect(searchCachedRecords(seeded(), 'yod-12').leads.map((lead) => lead.key)).toEqual([
      'YOD-12',
    ]);
  });

  test('an empty term finds nothing', () => {
    expect(searchCachedRecords(seeded(), '   ')).toBe(EMPTY_HITS);
  });

  test('reads people and companies from lists and from record caches', () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.people(listQuery), {
      pages: [
        { people: [personFixture({ id: 'p-list', name: 'Listed Person' })], nextCursor: null },
      ],
      pageParams: [null],
    });
    client.setQueryData(queryKeys.companies(listQuery), {
      pages: [
        { companies: [companyFixture({ id: 'c-list', name: 'Listed Co' })], nextCursor: null },
      ],
      pageParams: [null],
    });
    client.setQueryData(queryKeys.person('p-record'), {
      person: personFixture({ id: 'p-record', name: 'Recorded Person' }),
      employments: [],
      leads: [],
    });
    client.setQueryData(queryKeys.company('c-record'), {
      company: companyFixture({ id: 'c-record', name: 'Recorded Co', primaryDomain: 'rec.io' }),
      people: [
        {
          person: personFixture({ id: 'p-staff', name: 'Staff Member' }),
          employment: employmentFixture({ personId: 'p-staff', companyId: 'c-record' }),
        },
      ],
      leads: [],
    });
    expect(
      searchCachedRecords(client, 'person')
        .people.map((person) => person.id)
        .sort(),
    ).toEqual(['p-list', 'p-record']);
    expect(searchCachedRecords(client, 'staff').people.map((person) => person.id)).toEqual([
      'p-staff',
    ]);
    expect(
      searchCachedRecords(client, 'co')
        .companies.map((company) => company.id)
        .sort(),
    ).toEqual(['c-list', 'c-record']);
    expect(searchCachedRecords(client, 'rec.io').companies.map((company) => company.id)).toEqual([
      'c-record',
    ]);
  });

  test('the newest copy of a person wins and archived or pending rows never show', () => {
    const client = seeded();
    client.setQueryData(queryKeys.person('per1'), {
      person: personFixture({
        id: 'per1',
        name: 'Ada Byron',
        primaryEmail: 'ada@acme.io',
        syncId: 99,
      }),
      employments: [],
      leads: [],
    });
    client.setQueryData(queryKeys.person('gone'), {
      person: personFixture({
        id: 'gone',
        name: 'Ada Archived',
        archivedAt: '2026-10-02T00:00:00.000Z',
      }),
      employments: [],
      leads: [],
    });
    const hits = searchCachedRecords(client, 'ada').people;
    expect(hits.map((person) => person.name)).toEqual(['Ada Byron']);
    const pending = new QueryClient();
    pending.setQueryData(queryKeys.leads('p1', listQuery), {
      pages: [
        {
          leads: [leadFixture({ id: 'l9', personId: 'pending-l9', personName: 'Pending Pat' })],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    expect(searchCachedRecords(pending, 'pat').people).toEqual([]);
    expect(searchCachedRecords(pending, 'pat').leads).toHaveLength(1);
  });

  test('caps each group at the limit', () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.people(listQuery), {
      pages: [
        {
          people: Array.from({ length: 12 }, (_, index) =>
            personFixture({ id: `p${index}`, name: `Sam ${index}` }),
          ),
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    expect(searchCachedRecords(client, 'sam').people).toHaveLength(8);
    expect(searchCachedRecords(client, 'sam', 3).people).toHaveLength(3);
  });
});

describe('matchCachedPeople', () => {
  test('matches exactly by email, LinkedIn URL or name', () => {
    const client = seeded();
    expect(
      matchCachedPeople(client, { email: 'ADA@acme.io', linkedinUrl: null, name: null }).map(
        (person) => person.id,
      ),
    ).toEqual(['per1']);
    expect(
      matchCachedPeople(client, {
        email: null,
        linkedinUrl: 'https://www.linkedin.com/in/ada',
        name: null,
      }),
    ).toHaveLength(1);
    expect(
      matchCachedPeople(client, { email: null, linkedinUrl: null, name: 'grace hopper' }).map(
        (person) => person.id,
      ),
    ).toEqual(['per2']);
  });

  test('an empty probe matches nobody', () => {
    expect(matchCachedPeople(seeded(), { email: null, linkedinUrl: null, name: ' ' })).toEqual([]);
  });
});

describe('personHitOf and mergeHits', () => {
  test('maps a person row to a hit', () => {
    expect(
      personHitOf(
        personFixture({
          id: 'per7',
          name: 'Ada',
          primaryEmail: 'a@b.io',
          companyName: 'Acme',
          linkedinUrl: 'https://www.linkedin.com/in/ada',
        }),
      ),
    ).toEqual({
      id: 'per7',
      name: 'Ada',
      email: 'a@b.io',
      companyName: 'Acme',
      linkedinUrl: 'https://www.linkedin.com/in/ada',
    });
  });

  test('keeps the first copy of an id, appends the rest and honours a limit', () => {
    const first = [{ id: 'a', n: 1 }];
    const second = [
      { id: 'a', n: 2 },
      { id: 'b', n: 3 },
      { id: 'c', n: 4 },
    ];
    expect(mergeHits(first, second)).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 3 },
      { id: 'c', n: 4 },
    ]);
    expect(mergeHits(first, second, 2)).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 3 },
    ]);
  });
});
