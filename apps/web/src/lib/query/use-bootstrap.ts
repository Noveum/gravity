'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import { bootstrapSchema } from './schemas.ts';

export function useBootstrap() {
  return useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: ({ signal }) => apiFetch('/api/bootstrap', bootstrapSchema, { signal }),
    staleTime: 60_000,
  });
}
