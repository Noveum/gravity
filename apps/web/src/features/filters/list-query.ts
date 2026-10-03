import {
  decodeListQuery,
  type FilterGroup,
  type FilterNode,
  type FilterRegistry,
  filterGroupSchema,
  type ListQuery,
  pruneFilter,
} from '@gravity/shared/filters';
import type { SavedViewRow } from '@gravity/shared/records';

export const MAX_LIST_SEARCH_LENGTH = 200;

export function cappedSearch(q: string): string {
  return q.trim().slice(0, MAX_LIST_SEARCH_LENGTH).trim();
}

function parses(node: FilterNode): boolean {
  return filterGroupSchema.safeParse({ kind: 'group', combinator: 'and', children: [node] })
    .success;
}

function validNode(node: FilterNode): FilterNode | null {
  if (node.kind === 'condition') return parses(node) ? node : null;
  const children = node.children.flatMap((child) => {
    const kept = validNode(child);
    return kept === null ? [] : [kept];
  });
  return children.length === 0 ? null : { ...node, children };
}

export function safeFilter<T>(group: FilterGroup, registry: FilterRegistry<T>): FilterGroup {
  const pruned = pruneFilter(group, registry);
  if (filterGroupSchema.safeParse(pruned).success) return pruned;
  const children = pruned.children.flatMap((child) => {
    const kept = validNode(child);
    return kept === null ? [] : [kept];
  });
  const repaired = { ...pruned, children };
  return filterGroupSchema.safeParse(repaired).success ? repaired : { ...pruned, children: [] };
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
