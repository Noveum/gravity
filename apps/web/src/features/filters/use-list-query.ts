'use client';

import {
  encodeFilter,
  type FilterGroup,
  type FilterRegistry,
  isEmptyFilter,
  type ListQuery,
  safeFilter,
} from '@gravity/shared/filters';
import type { SavedViewRow } from '@gravity/shared/records';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cappedSearch, resolveListQuery } from './list-query.ts';

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
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.toString();
  const viewId = params.get('view');
  const latest = useRef(raw);

  useEffect(() => {
    latest.current = raw;
  }, [raw]);

  const query = useMemo(
    () => resolveListQuery(raw, savedViews, registry),
    [raw, savedViews, registry],
  );

  const write = useCallback(
    (edit: (search: URLSearchParams) => void) => {
      const search = new URLSearchParams(latest.current);
      edit(search);
      const next = search.toString();
      latest.current = next;
      window.history.replaceState(null, '', next.length === 0 ? pathname : `${pathname}?${next}`);
    },
    [pathname],
  );

  const setFilter = useCallback(
    (filter: FilterGroup) =>
      write((search) => {
        const encoded = encodeFilter(safeFilter(filter, registry));
        if (encoded.length === 0) {
          search.delete('filter');
          search.delete('view');
        } else search.set('filter', encoded);
      }),
    [write, registry],
  );
  const setQ = useCallback(
    (q: string) =>
      write((search) => {
        const capped = cappedSearch(q);
        if (capped.length === 0) search.delete('q');
        else search.set('q', capped);
      }),
    [write],
  );
  const clear = useCallback(
    () =>
      write((search) => {
        search.delete('filter');
        search.delete('q');
        search.delete('view');
      }),
    [write],
  );
  const openView = useCallback(
    (view: SavedViewRow) =>
      write((search) => {
        search.delete('filter');
        search.set('view', view.id);
      }),
    [write],
  );

  return {
    query,
    viewId,
    hasFilter: !isEmptyFilter(query.filter) || query.q.length > 0,
    setFilter,
    setQ,
    clear,
    openView,
  };
}
