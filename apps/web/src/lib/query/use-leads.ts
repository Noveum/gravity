'use client';

import { encodeListQuery, type ListQuery } from '@gravity/shared/filters';
import type { LeadRow } from '@gravity/shared/records';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiFetch } from './fetcher.ts';
import { LEADS_ROOT, queryKeys } from './keys.ts';
import { cachedLead } from './lead-cache.ts';
import { keepPreviousWithin } from './pages.ts';
import { leadEnvelopeSchema, leadPageSchema } from './schemas.ts';
import { useAllPages } from './use-all-pages.ts';

function leadListPath(pipelineId: string, search: string, cursor: string | null): string {
  const params = new URLSearchParams(search);
  params.set('pipelineId', pipelineId);
  if (cursor !== null) params.set('cursor', cursor);
  return `/api/leads?${params.toString()}`;
}

export function useLeadList(pipelineId: string | null, query: ListQuery) {
  const search = encodeListQuery(query);
  const scope = pipelineId ?? '';
  const result = useInfiniteQuery({
    queryKey: queryKeys.leads(scope, search),
    enabled: pipelineId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(leadListPath(scope, search, pageParam), leadPageSchema, { signal }),
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousWithin([LEADS_ROOT, scope]),
  });
  useAllPages(result);
  const leads = useMemo<LeadRow[]>(
    () => (result.data?.pages ?? []).flatMap((page) => page.leads),
    [result.data],
  );
  return { ...result, leads, search };
}

export function useLead(id: string | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.lead(id ?? ''),
    enabled: id !== null,
    initialData: () => (id === null ? undefined : cachedLead(client, id)),
    queryFn: async ({ signal }) =>
      (await apiFetch(`/api/leads/${encodeURIComponent(id ?? '')}`, leadEnvelopeSchema, { signal }))
        .lead,
  });
}
