import { describe, expect, test } from 'bun:test';
import {
  emptyFilterGroup,
  encodeFilter,
  inCondition,
  leadFilterRegistry,
  replaceCondition,
} from '@gravity/shared/filters';
import type { SavedViewRow } from '@gravity/shared/records';
import { act, renderHook } from '@testing-library/react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { mockNavigation, watchHistoryReplace } from '../../support/navigation.ts';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads/YOD');
const replaced = watchHistoryReplace(navigation);

const { useListQuery } = await import('@/features/filters/use-list-query.ts');

const registry = leadFilterRegistry();
const readyFilter = replaceCondition(emptyFilterGroup(), inCondition('stage', ['ready']));
const view: SavedViewRow = {
  id: 'v1',
  object: 'lead',
  pipelineId: 'p1',
  name: 'Ready',
  filter: readyFilter,
  display: {},
  visibility: 'private',
  ownerId: 'u1',
  position: 0,
  syncId: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

describe('useListQuery', () => {
  test('an open view supplies the filter until the URL carries one', () => {
    navigation.search = 'view=v1';
    const opened = renderHook(() => useListQuery(registry, [view]));
    expect(opened.result.current.query.filter).toEqual(readyFilter);
    expect(opened.result.current.viewId).toBe('v1');
    navigation.search = 'view=v1&filter=';
    const cleared = renderHook(() => useListQuery(registry, [view]));
    expect(cleared.result.current.query.filter.children).toHaveLength(0);
  });

  test('writes the filter and the search term into the URL and keeps both', () => {
    navigation.search = '';
    const { result, rerender } = renderHook(() => useListQuery(registry, []));
    act(() => result.current.setFilter(readyFilter));
    const filtered = new URLSearchParams({ filter: encodeFilter(readyFilter) }).toString();
    expect(replaced).toHaveBeenLastCalledWith(`/leads/YOD?${filtered}`);
    rerender();
    expect(result.current.query.filter).toEqual(readyFilter);
    act(() => result.current.setQ(' ada '));
    expect(replaced).toHaveBeenLastCalledWith(`/leads/YOD?${filtered}&q=ada`);
    rerender();
    expect(result.current.query).toEqual({ filter: readyFilter, q: 'ada' });
    expect(result.current.hasFilter).toBe(true);
  });

  test('two writes before the address updates both land', () => {
    navigation.search = '';
    const { result } = renderHook(() => useListQuery(registry, []));
    act(() => {
      result.current.setFilter(readyFilter);
      result.current.setQ('ada');
    });
    const both = new URLSearchParams({ filter: encodeFilter(readyFilter), q: 'ada' }).toString();
    expect(replaced).toHaveBeenLastCalledWith(`/leads/YOD?${both}`);
  });

  test('a condition the registry cannot run or the schema rejects never reaches the URL', () => {
    navigation.search = '';
    const { result } = renderHook(() => useListQuery(registry, []));
    const invalid = {
      ...emptyFilterGroup(),
      children: [
        inCondition('stage', []),
        inCondition('nonsense', ['x']),
        inCondition('owner', ['me']),
      ],
    };
    act(() => result.current.setFilter(invalid));
    const kept = replaceCondition(emptyFilterGroup(), inCondition('owner', ['me']));
    const expected = new URLSearchParams({ filter: encodeFilter(kept) }).toString();
    expect(replaced).toHaveBeenLastCalledWith(`/leads/YOD?${expected}`);
  });

  test('clearing drops the filter, the search term and the open view', () => {
    navigation.search = 'view=v1&q=ada';
    const { result } = renderHook(() => useListQuery(registry, [view]));
    act(() => result.current.clear());
    expect(replaced).toHaveBeenLastCalledWith('/leads/YOD');
  });

  test('removing the last condition of an open view closes the view and keeps the search', () => {
    navigation.search = 'view=v1&q=ada';
    const { result } = renderHook(() => useListQuery(registry, [view]));
    act(() => result.current.setFilter(emptyFilterGroup()));
    expect(replaced).toHaveBeenLastCalledWith('/leads/YOD?q=ada');
  });

  test('the search term is capped at 200 characters', () => {
    navigation.search = '';
    const { result } = renderHook(() => useListQuery(registry, []));
    act(() => result.current.setQ('a'.repeat(300)));
    expect(replaced).toHaveBeenLastCalledWith(`/leads/YOD?q=${'a'.repeat(200)}`);
  });
});
