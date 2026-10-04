import {
  decodeListQuery,
  type FilterRegistry,
  type ListQuery,
  safeFilter,
} from '@gravity/shared/filters';
import type { SavedViewRow } from '@gravity/shared/records';

export const MAX_LIST_SEARCH_LENGTH = 200;

export function cappedSearch(q: string): string {
  return q.trim().slice(0, MAX_LIST_SEARCH_LENGTH).trim();
}

export function resolveListQuery<T>(
  search: string,
  views: readonly SavedViewRow[],
  registry: FilterRegistry<T>,
): ListQuery {
  const params = new URLSearchParams(search);
  const decoded = decodeListQuery(search);
  const view = views.find((entry) => entry.id === params.get('view'));
  const filter = params.has('filter') || view === undefined ? decoded.filter : view.filter;
  return { filter: safeFilter(filter, registry), q: cappedSearch(decoded.q) };
}

export function leadViewsFor(
  views: readonly SavedViewRow[],
  pipelineId: string | null,
): SavedViewRow[] {
  return views.filter(
    (view) =>
      view.object === 'lead' && (view.pipelineId === null || view.pipelineId === pipelineId),
  );
}
