import {
  decodeListQuery,
  evaluateFilter,
  type FilterContext,
  type FilterRegistry,
  matchesSearch,
} from '@gravity/shared/filters';
import type { InfiniteData, Query, QueryClient } from '@tanstack/react-query';

export type Pages<TPage> = InfiniteData<TPage, string | null>;

interface Identified {
  readonly id: string;
}

interface Versioned extends Identified {
  readonly syncId: number;
}

type ReadRows<TPage, TRow> = (page: TPage) => readonly TRow[];
type WriteRows<TPage, TRow> = (page: TPage, rows: TRow[]) => TPage;

export function rowsOfPages<TPage, TRow>(
  pages: Pages<TPage> | undefined,
  read: ReadRows<TPage, TRow>,
): TRow[] {
  return (pages?.pages ?? []).flatMap((page) => [...read(page)]);
}

export function withoutRow<TRow extends Identified>(
  rows: readonly TRow[],
  id: string,
): readonly TRow[] {
  return rows.some((row) => row.id === id) ? rows.filter((row) => row.id !== id) : rows;
}

export function placeInRows<TRow extends Identified>(
  rows: readonly TRow[],
  row: TRow,
  belongs: boolean,
): readonly TRow[] {
  if (!belongs) return withoutRow(rows, row.id);
  return rows.some((entry) => entry.id === row.id)
    ? rows.map((entry) => (entry.id === row.id ? row : entry))
    : [row, ...rows];
}

function mapPages<TPage, TRow>(
  pages: Pages<TPage>,
  read: ReadRows<TPage, TRow>,
  write: WriteRows<TPage, TRow>,
  change: (rows: readonly TRow[]) => readonly TRow[],
): Pages<TPage> {
  let changed = false;
  const next = pages.pages.map((page) => {
    const rows = read(page);
    const updated = change(rows);
    if (updated === rows) return page;
    changed = true;
    return write(page, [...updated]);
  });
  return changed ? { ...pages, pages: next } : pages;
}

export function dedupePages<TPage, TRow extends Versioned>(
  read: ReadRows<TPage, TRow>,
  write: WriteRows<TPage, TRow>,
): (pages: Pages<TPage>) => Pages<TPage> {
  return (pages) => {
    const newest = new Map(newestRows(rowsOfPages(pages, read)).map((row) => [row.id, row]));
    const seen = new Set<string>();
    return mapPages(pages, read, write, (rows) => {
      const kept = rows.flatMap((row) => {
        if (seen.has(row.id)) return [];
        seen.add(row.id);
        return [newest.get(row.id) ?? row];
      });
      const same = kept.length === rows.length && kept.every((row, index) => row === rows[index]);
      return same ? rows : kept;
    });
  };
}

export function removeFromPages<TPage, TRow extends Identified>(
  pages: Pages<TPage>,
  id: string,
  read: ReadRows<TPage, TRow>,
  write: WriteRows<TPage, TRow>,
): Pages<TPage> {
  return mapPages(pages, read, write, (rows) => withoutRow(rows, id));
}

export function placeInPages<TPage, TRow extends Identified>(
  pages: Pages<TPage>,
  row: TRow,
  belongs: boolean,
  read: ReadRows<TPage, TRow>,
  write: WriteRows<TPage, TRow>,
): Pages<TPage> {
  const holds = (rows: readonly TRow[]) => rows.some((entry) => entry.id === row.id);
  if (pages.pages.some((page) => holds(read(page)))) {
    return mapPages(pages, read, write, (rows) =>
      holds(rows) ? placeInRows(rows, row, belongs) : rows,
    );
  }
  if (!belongs) return pages;
  const [first, ...rest] = pages.pages;
  if (first === undefined) return pages;
  return { ...pages, pages: [write(first, [row, ...read(first)]), ...rest] };
}

export function matchesListQuery<TRow extends { readonly archivedAt: string | null }>(
  row: TRow,
  search: string,
  registry: FilterRegistry<TRow>,
  context: FilterContext,
): boolean {
  if (row.archivedAt !== null) return false;
  const query = decodeListQuery(search);
  return (
    evaluateFilter(query.filter, row, registry, context) && matchesSearch(row, query.q, registry)
  );
}

export function placeInLists<TPage, TRow extends Identified>(
  client: QueryClient,
  root: string,
  row: TRow,
  belongs: (key: readonly unknown[]) => boolean | null,
  read: ReadRows<TPage, TRow>,
  write: WriteRows<TPage, TRow>,
): void {
  for (const [key, pages] of client.getQueriesData<Pages<TPage>>({ queryKey: [root] })) {
    if (pages === undefined) continue;
    const verdict = belongs(key);
    if (verdict === null) continue;
    const next = placeInPages(pages, row, verdict, read, write);
    if (next !== pages) client.setQueryData<Pages<TPage>>(key, next);
  }
}

export function removeFromLists<TPage, TRow extends Identified>(
  client: QueryClient,
  root: string,
  id: string,
  read: ReadRows<TPage, TRow>,
  write: WriteRows<TPage, TRow>,
): void {
  for (const [key, pages] of client.getQueriesData<Pages<TPage>>({ queryKey: [root] })) {
    if (pages === undefined) continue;
    const next = removeFromPages(pages, id, read, write);
    if (next !== pages) client.setQueryData<Pages<TPage>>(key, next);
  }
}

export function newestRows<TRow extends Versioned>(rows: Iterable<TRow>): TRow[] {
  const byId = new Map<string, TRow>();
  for (const row of rows) {
    const known = byId.get(row.id);
    if (known === undefined || known.syncId < row.syncId) byId.set(row.id, row);
  }
  return [...byId.values()];
}

export function newestOf<TRow extends { readonly syncId: number }>(
  rows: Iterable<TRow | undefined>,
): TRow | undefined {
  let newest: TRow | undefined;
  for (const row of rows) {
    if (row !== undefined && (newest === undefined || newest.syncId < row.syncId)) newest = row;
  }
  return newest;
}

export function isStale(
  known: { readonly syncId: number } | undefined,
  row: { readonly syncId: number },
): boolean {
  return known !== undefined && row.syncId < known.syncId;
}

export function cachedRows<TPage, TRow extends Versioned>(
  client: QueryClient,
  root: string,
  read: ReadRows<TPage, TRow>,
): TRow[] {
  return newestRows(
    client
      .getQueriesData<Pages<TPage>>({ queryKey: [root] })
      .flatMap(([, pages]) => rowsOfPages(pages, read)),
  );
}

export function newestListed<TPage, TRow extends Versioned>(
  client: QueryClient,
  root: string,
  id: string,
  read: ReadRows<TPage, TRow>,
): TRow | undefined {
  let newest: TRow | undefined;
  for (const [, pages] of client.getQueriesData<Pages<TPage>>({ queryKey: [root] })) {
    for (const page of pages?.pages ?? []) {
      const row = read(page).find((entry) => entry.id === id);
      if (row !== undefined && (newest === undefined || newest.syncId < row.syncId)) newest = row;
    }
  }
  return newest;
}

export function keepPreviousWithin(scope: readonly unknown[]) {
  return <TData>(
    previous: TData | undefined,
    previousQuery: { readonly queryKey: readonly unknown[] } | undefined,
  ): TData | undefined =>
    previousQuery !== undefined &&
    scope.every((part, index) => previousQuery.queryKey[index] === part)
      ? previous
      : undefined;
}

const hasData = (query: Query) => query.state.data !== undefined;

export async function cancelLoadedQueries(
  client: QueryClient,
  ...roots: readonly string[]
): Promise<void> {
  await Promise.all(
    roots.map((root) => client.cancelQueries({ queryKey: [root], predicate: hasData })),
  );
}
