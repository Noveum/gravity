'use client';

import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@/lib/use-debounced-value.ts';
import { apiFetch } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { RecordProbe } from './record-search.ts';
import { duplicatesSchema, searchResultSchema } from './schemas.ts';

const MIN_TERM = 2;

export function useRecordSearch(term: string) {
  const settled = useDebouncedValue(term.trim());
  return useQuery({
    queryKey: queryKeys.search(settled),
    enabled: settled.length >= MIN_TERM,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      apiFetch(`/api/search?q=${encodeURIComponent(settled)}`, searchResultSchema, { signal }),
  });
}

function probeSearch(probe: RecordProbe): string {
  const params = new URLSearchParams();
  if (probe.email !== null) params.set('email', probe.email);
  if (probe.linkedinUrl !== null) params.set('linkedinUrl', probe.linkedinUrl);
  if (probe.name !== null && probe.name.trim().length >= MIN_TERM) {
    params.set('name', probe.name.trim());
  }
  return params.toString();
}

export function useDuplicates(probe: RecordProbe) {
  const settled = useDebouncedValue(probeSearch(probe));
  return useQuery({
    queryKey: queryKeys.duplicates(settled),
    enabled: settled.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) => apiFetch(`/api/duplicates?${settled}`, duplicatesSchema, { signal }),
  });
}
