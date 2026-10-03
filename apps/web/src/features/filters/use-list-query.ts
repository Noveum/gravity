'use client';

import {
  decodeListQuery,
  encodeFilter,
  type FilterGroup,
  type FilterRegistry,
  isEmptyFilter,
  type ListQuery,
  pruneFilter,
} from '@gravity/shared/filters';
import type { SavedViewRow } from '@gravity/shared/records';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

export interface ListQueryState {
  readonly query: ListQuery;
  readonly viewId: string | null;
  readonly hasFilter: boolean;
  readonly setFilter: (filter: FilterGroup) => void;
  readonly setQ: (q: string) => void;
  readonly clear: () => void;
  readonly openView: (view: SavedViewRow) => void;
}

export function useListQuery<T>(
  registry: FilterRegistry<T>,
  savedViews: readonly SavedViewRow[],
): ListQueryState {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.toString();
  const viewId = params.get('view');

  const query = useMemo<ListQuery>(() => {
    const current = new URLSearchParams(raw);
    const decoded = decodeListQuery(raw);
    const view = savedViews.find((entry) => entry.id === current.get('view'));
    const filter = current.has('filter') || view === undefined ? decoded.filter : view.filter;
    return { filter: pruneFilter(filter, registry), q: decoded.q };
  }, [raw, savedViews, registry]);

  const write = useCallback(
    (edit: (search: URLSearchParams) => void) => {
      const search = new URLSearchParams(raw);
      edit(search);
      const next = search.toString();
      router.replace(next.length === 0 ? pathname : `${pathname}?${next}`, { scroll: false });
    },
    [raw, router, pathname],
  );

  return {
    query,
    viewId,
    hasFilter: !isEmptyFilter(query.filter) || query.q.length > 0,
    setFilter: (filter) => write((search) => search.set('filter', encodeFilter(filter))),
    setQ: (q) =>
      write((search) => {
        if (q.trim().length === 0) search.delete('q');
        else search.set('q', q.trim());
      }),
    clear: () =>
      write((search) => {
        search.delete('filter');
        search.delete('q');
        search.delete('view');
      }),
    openView: (view) =>
      write((search) => {
        search.delete('filter');
        search.set('view', view.id);
      }),
  };
}
