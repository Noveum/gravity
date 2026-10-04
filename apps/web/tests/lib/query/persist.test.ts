import { describe, expect, test } from 'bun:test';
import { dehydrate, hydrate, QueryClient, type QueryKey } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys.ts';
import { restorable, shouldPersistQuery } from '@/lib/query/persist.ts';
import type { CompanyRecord, PersonRecord } from '@/lib/query/schemas.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { companyFixture, employmentFixture, personFixture } from '../../support/record-fixtures.ts';

const lead = leadFixture({ companyId: 'c1', companyName: 'Acme' });
const person = personFixture({ companyId: 'c1', companyName: 'Acme' });
const company = companyFixture();
const personRecord: PersonRecord = { person, employments: [employmentFixture()], leads: [lead] };
const companyRecord: CompanyRecord = {
  company,
  people: [{ person, employment: employmentFixture() }],
  leads: [lead],
};

const PERSISTED: readonly (readonly [string, QueryKey, unknown])[] = [
  ['bootstrap', queryKeys.bootstrap, bootstrapFixture()],
  ['lead', queryKeys.lead('l1'), lead],
  [
    'leads',
    queryKeys.leads('p1', 'q=ada'),
    { pages: [{ leads: [lead], nextCursor: 'c2' }], pageParams: [null] },
  ],
  [
    'people',
    queryKeys.people(''),
    { pages: [{ people: [person], nextCursor: null }], pageParams: [null] },
  ],
  ['person', queryKeys.person('per1'), personRecord],
  [
    'companies',
    queryKeys.companies(''),
    { pages: [{ companies: [company], nextCursor: null }], pageParams: [null] },
  ],
  ['company', queryKeys.company('c1'), companyRecord],
];

function persistedFrom(client: QueryClient): unknown {
  const clientState = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery });
  return JSON.parse(JSON.stringify({ buster: 'b', timestamp: 1, clientState }));
}

describe('restorable', () => {
  for (const [root, key, data] of PERSISTED) {
    test(`a ${root} entry survives the round trip and a malformed one is dropped`, () => {
      const source = new QueryClient();
      source.setQueryData(key, data);
      source.setQueryData(queryKeys.search('ada'), { people: [] });
      const restored = restorable(persistedFrom(source));
      expect(restored.clientState.queries.map((query) => query.queryKey)).toEqual([[...key]]);
      const target = new QueryClient();
      hydrate(target, restored.clientState);
      expect(target.getQueryData<unknown>(key)).toEqual(data);

      const broken = new QueryClient();
      broken.setQueryData(key, { id: 1 });
      expect(restorable(persistedFrom(broken)).clientState.queries).toEqual([]);
    });
  }

  test('the list of MCP connections is never written to the offline cache', () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.mcpGrants, { connections: [] });
    expect(queryKeys.mcpGrants).toEqual(['mcp-grants']);
    expect(persistedFrom(client)).toMatchObject({ clientState: { queries: [] } });
  });

  test('a lead list with a malformed row is dropped while a valid one is kept', () => {
    const client = restorable({
      buster: 'b',
      timestamp: 1,
      clientState: {
        mutations: [],
        queries: [
          {
            queryKey: ['leads', 'p1', ''],
            queryHash: 'a',
            state: {
              data: { pages: [{ leads: [leadFixture()], nextCursor: null }], pageParams: [null] },
            },
          },
          {
            queryKey: ['leads', 'p1', 'q=x'],
            queryHash: 'b',
            state: { data: { pages: [{ leads: [{ id: 1 }] }] } },
          },
          { queryKey: ['search', 'ada'], queryHash: 'c', state: { data: {} } },
        ],
      },
    });
    expect(client.clientState.queries.map((query) => query.queryHash)).toEqual(['a']);
  });
});
