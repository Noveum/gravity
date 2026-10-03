import { describe, expect, test } from 'bun:test';
import {
  dedupePages,
  keepPreviousWithin,
  type Pages,
  placeInPages,
  removeFromPages,
} from '@/lib/query/pages.ts';

interface Row {
  readonly id: string;
  readonly label: string;
}

interface Page {
  readonly rows: Row[];
}

const read = (page: Page) => page.rows;
const write = (page: Page, rows: Row[]): Page => ({ ...page, rows });

function pagesOf(...pages: Row[][]): Pages<Page> {
  return { pages: pages.map((rows) => ({ rows })), pageParams: pages.map(() => null) };
}

function labels(pages: Pages<Page>): string[][] {
  return pages.pages.map((page) => page.rows.map((row) => `${row.id}:${row.label}`));
}

describe('placeInPages', () => {
  const second = pagesOf([{ id: 'a', label: 'old' }], [{ id: 'b', label: 'old' }]);

  test('replaces a row in the page that holds it and leaves the other pages alone', () => {
    const placed = placeInPages(second, { id: 'b', label: 'new' }, true, read, write);
    expect(labels(placed)).toEqual([['a:old'], ['b:new']]);
    expect(placed.pages[0]).toBe(second.pages[0]);
  });

  test('prepends a newly matching row to the first page only', () => {
    const placed = placeInPages(second, { id: 'c', label: 'new' }, true, read, write);
    expect(labels(placed)).toEqual([['c:new', 'a:old'], ['b:old']]);
  });

  test('removes a row that no longer matches and returns the same object when nothing changes', () => {
    expect(labels(placeInPages(second, { id: 'b', label: 'x' }, false, read, write))).toEqual([
      ['a:old'],
      [],
    ]);
    expect(placeInPages(second, { id: 'z', label: 'x' }, false, read, write)).toBe(second);
    expect(removeFromPages(second, 'z', read, write)).toBe(second);
  });
});

describe('keepPreviousWithin', () => {
  test('keeps the previous data only while the key stays inside the scope', () => {
    const keep = keepPreviousWithin(['leads', 'p1']);
    expect(keep('rows', { queryKey: ['leads', 'p1', 'q=a'] })).toBe('rows');
    expect(keep('rows', { queryKey: ['leads', 'p2', 'q=a'] })).toBeUndefined();
    expect(keep('rows', undefined)).toBeUndefined();
  });
});

describe('dedupePages', () => {
  interface Versioned {
    readonly id: string;
    readonly syncId: number;
  }
  interface VersionedPage {
    readonly rows: Versioned[];
  }
  const dedupe = dedupePages(
    (page: VersionedPage) => page.rows,
    (page: VersionedPage, rows: Versioned[]): VersionedPage => ({ ...page, rows }),
  );
  const loaded = (...pages: Versioned[][]): Pages<VersionedPage> => ({
    pages: pages.map((rows) => ({ rows })),
    pageParams: pages.map(() => null),
  });

  test('keeps one copy of a row that a later page repeats, with the higher sync id', () => {
    const deduped = dedupe(
      loaded(
        [
          { id: 'x', syncId: 5 },
          { id: 'a', syncId: 1 },
        ],
        [
          { id: 'b', syncId: 1 },
          { id: 'x', syncId: 7 },
        ],
      ),
    );
    expect(deduped.pages.map((page) => page.rows)).toEqual([
      [
        { id: 'x', syncId: 7 },
        { id: 'a', syncId: 1 },
      ],
      [{ id: 'b', syncId: 1 }],
    ]);
  });

  test('returns the same object when no row repeats', () => {
    const unique = loaded([{ id: 'a', syncId: 1 }], [{ id: 'b', syncId: 1 }]);
    expect(dedupe(unique)).toBe(unique);
  });
});
