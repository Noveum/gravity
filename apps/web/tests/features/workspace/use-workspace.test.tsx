import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { wrapperFor } from '../../support/query-wrapper.tsx';

function seeded(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.bootstrap, bootstrapFixture());
  return client;
}

describe('useWorkspace', () => {
  test('stagesOf returns the same array for a pipeline until the bootstrap changes', () => {
    const client = seeded();
    const { result, rerender } = renderHook(() => useWorkspace(), {
      wrapper: wrapperFor(client),
    });
    const first = result.current.stagesOf('p1');
    expect(first.map((stage) => stage.name).slice(0, 2)).toEqual(['New', 'Researching']);
    rerender();
    expect(result.current.stagesOf('p1')).toBe(first);
    expect(result.current.stagesOf('missing')).toBe(result.current.stagesOf('also-missing'));
  });
});
