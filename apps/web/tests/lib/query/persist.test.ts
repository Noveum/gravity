import { describe, expect, test } from 'bun:test';
import { restorable } from '@/lib/query/persist.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

describe('restorable', () => {
  test('keeps a valid lead list and drops a malformed one', () => {
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
