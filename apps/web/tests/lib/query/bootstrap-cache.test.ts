import { describe, expect, test } from 'bun:test';
import type { SyncAction } from '@gravity/shared/events';
import { QueryClient } from '@tanstack/react-query';
import { applyBootstrapDelta } from '@/lib/query/bootstrap-cache.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Bootstrap } from '@/lib/query/schemas.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';

function memberUpdate(memberId: string, role: string, syncId: number): SyncAction {
  return {
    syncId,
    organizationId: 'o1',
    scopes: ['workspace:o1'],
    action: 'update',
    model: 'member',
    modelId: memberId,
    data: { id: memberId, role, syncId },
    actor: { type: 'user', id: 'u2' },
    at: '2026-10-02T10:00:00.000Z',
  };
}

function client(): QueryClient {
  const created = new QueryClient();
  created.setQueryData(queryKeys.bootstrap, bootstrapFixture());
  return created;
}

function bootstrapOf(cache: QueryClient): Bootstrap | undefined {
  return cache.getQueryData<Bootstrap>(queryKeys.bootstrap);
}

describe('applyBootstrapDelta for members', () => {
  test('a role change for the caller also changes their own role', () => {
    const cache = client();
    applyBootstrapDelta(cache, memberUpdate('m1', 'contributor', 5));
    expect(bootstrapOf(cache)?.me.role).toBe('contributor');
    expect(bootstrapOf(cache)?.members.find((member) => member.memberId === 'm1')?.role).toBe(
      'contributor',
    );
  });

  test('a role change for a teammate leaves the caller role alone', () => {
    const cache = client();
    applyBootstrapDelta(cache, memberUpdate('m2', 'guest', 5));
    expect(bootstrapOf(cache)?.me.role).toBe('admin');
    expect(bootstrapOf(cache)?.members.find((member) => member.memberId === 'm2')?.role).toBe(
      'guest',
    );
  });
});
