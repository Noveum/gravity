import { describe, expect, test } from 'bun:test';
import {
  emptyFilterGroup,
  encodeFilter,
  type FilterGroup,
  inCondition,
  leadFilterRegistry,
  replaceCondition,
} from '@gravity/shared/filters';
import type { SavedViewRow } from '@gravity/shared/records';
import { leadViewsFor, resolveListQuery, safeFilter } from '@/features/filters/list-query.ts';

const registry = leadFilterRegistry();
const ready = replaceCondition(emptyFilterGroup(), inCondition('stage', ['ready']));

function view(overrides: Partial<SavedViewRow>): SavedViewRow {
  return {
    id: 'v1',
    object: 'lead',
    pipelineId: 'p1',
    name: 'Ready',
    filter: ready,
    display: {},
    visibility: 'private',
    ownerId: 'u1',
    position: 0,
    syncId: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('list query', () => {
  test('the URL filter wins over the open view, and the view fills in when it is absent', () => {
    const views = [view({})];
    expect(resolveListQuery('view=v1&q=ada', views, registry)).toEqual({ filter: ready, q: 'ada' });
    expect(resolveListQuery('view=v1&filter=', views, registry).filter).toEqual(emptyFilterGroup());
    const owner = replaceCondition(emptyFilterGroup(), inCondition('owner', ['me']));
    const search = new URLSearchParams({ view: 'v1', filter: encodeFilter(owner) }).toString();
    expect(resolveListQuery(search, views, registry).filter).toEqual(owner);
    expect(resolveListQuery('view=missing', views, registry).filter).toEqual(emptyFilterGroup());
  });

  test('a filter is pruned to what the registry and the schema accept', () => {
    const broken: FilterGroup = {
      kind: 'group',
      combinator: 'or',
      children: [
        inCondition('stage', []),
        inCondition('nonsense', ['x']),
        {
          kind: 'group',
          combinator: 'and',
          children: [inCondition('stage', []), inCondition('owner', ['me'])],
        },
      ],
    };
    expect(safeFilter(broken, registry)).toEqual({
      kind: 'group',
      combinator: 'or',
      children: [{ kind: 'group', combinator: 'and', children: [inCondition('owner', ['me'])] }],
    });
    expect(safeFilter(ready, registry)).toEqual(ready);
  });

  test('lead views are those of this pipeline or of every pipeline', () => {
    const views = [
      view({}),
      view({ id: 'v2', pipelineId: null }),
      view({ id: 'v3', pipelineId: 'p2' }),
      view({ id: 'v4', object: 'person', pipelineId: null }),
    ];
    expect(leadViewsFor(views, 'p1').map((entry) => entry.id)).toEqual(['v1', 'v2']);
  });

  test('a search term longer than 200 characters is cut to 200', () => {
    const long = 'a'.repeat(300);
    expect(resolveListQuery(`q=${long}`, [], registry).q).toBe('a'.repeat(200));
  });
});
