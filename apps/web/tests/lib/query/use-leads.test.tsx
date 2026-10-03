import { describe, expect, test } from 'bun:test';
import { EMPTY_LIST_QUERY, encodeListQuery } from '@gravity/shared/filters';
import { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { queryKeys } from '@/lib/query/keys.ts';
import { useLeadList } from '@/lib/query/use-leads.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { wrapperFor } from '../../support/query-wrapper.tsx';

describe('useLeadList', () => {
  test('shows one copy of a lead that a later page repeats, keeping the newer one', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
    });
    client.setQueryData(queryKeys.leads('p1', encodeListQuery(EMPTY_LIST_QUERY)), {
      pages: [
        { leads: [leadFixture({ id: 'l9', syncId: 12 }), leadFixture()], nextCursor: 'c2' },
        { leads: [leadFixture({ id: 'l9', syncId: 11 })], nextCursor: null },
      ],
      pageParams: [null, 'c2'],
    });
    const { result } = renderHook(() => useLeadList('p1', EMPTY_LIST_QUERY), {
      wrapper: wrapperFor(client),
    });
    expect(result.current.leads.map((lead) => [lead.id, lead.syncId])).toEqual([
      ['l9', 12],
      ['l1', 10],
    ]);
  });
});
