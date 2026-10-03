'use client';

import { useEffect } from 'react';

export interface PagedQuery {
  readonly hasNextPage: boolean;
  readonly isFetching: boolean;
  readonly isPlaceholderData: boolean;
  readonly isFetchNextPageError: boolean;
  readonly fetchNextPage: () => Promise<unknown>;
}

export function useAllPages(query: PagedQuery): void {
  const { hasNextPage, isFetching, isPlaceholderData, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    if (!hasNextPage || isFetching || isPlaceholderData || isFetchNextPageError) return;
    fetchNextPage().catch(() => undefined);
  }, [hasNextPage, isFetching, isPlaceholderData, isFetchNextPageError, fetchNextPage]);
}
