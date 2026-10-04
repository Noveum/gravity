import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useCan } from '@/features/workspace/use-can.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { mutationClient, wrapperFor } from '../../support/query-wrapper.tsx';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function canWith(
  role: 'guest' | 'contributor' | 'member' | 'admin' | null,
  permission: Parameters<typeof useCan>[0],
) {
  const client = mutationClient();
  if (role !== null) {
    client.setQueryData(queryKeys.bootstrap, bootstrapFixture({ me: { userId: 'u1', role } }));
  }
  return renderHook(() => useCan(permission), { wrapper: wrapperFor(client) }).result.current;
}

describe('useCan', () => {
  test('follows the role in the bootstrap', () => {
    expect(canWith('guest', 'pipeline:manage')).toBe(false);
    expect(canWith('contributor', 'pipeline:manage')).toBe(false);
    expect(canWith('member', 'pipeline:manage')).toBe(true);
    expect(canWith('member', 'field:manage')).toBe(true);
    expect(canWith('member', 'member:manage')).toBe(false);
    expect(canWith('admin', 'member:manage')).toBe(true);
  });

  test('says no until the bootstrap has arrived', () => {
    globalThis.fetch = mock(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;
    expect(canWith(null, 'record:read')).toBe(false);
  });
});
