import { describe, expect, mock, test } from 'bun:test';
import type { SyncAction } from '@gravity/shared/events';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

await restoreModulesAfterThisFile(['next/navigation']);

const refresh = mock();
mock.module('next/navigation', () => ({
  usePathname: () => '/settings/members',
  useRouter: () => ({ push: mock(), replace: mock(), refresh, prefetch: mock() }),
  redirect: mock(),
  notFound: mock(),
}));

const { MembersPanel } = await import('@/features/settings/members-panel.tsx');
const { applyDelta } = await import('@/lib/realtime/delta-bridge.tsx');

function delta(model: SyncAction['model'], syncId: number): SyncAction {
  return {
    syncId,
    organizationId: 'o1',
    scopes: ['workspace:o1'],
    action: 'update',
    model,
    modelId: `${model}_1`,
    data: {},
    actor: { type: 'user', id: 'u2' },
    at: new Date(0).toISOString(),
  };
}

describe('MembersPanel', () => {
  test('refreshes when a member or invitation changes elsewhere, and stops once unmounted', () => {
    const view = render(
      <MembersPanel
        currentUserId="u1"
        members={[]}
        invites={[]}
        canInvite={false}
        canInviteAdmins={false}
        canManage={false}
        canDeliverInvites={false}
      />,
    );
    const client = new QueryClient();

    applyDelta(delta('member', 1), client);
    applyDelta(delta('invitation', 2), client);
    applyDelta(delta('person', 3), client);
    expect(refresh).toHaveBeenCalledTimes(2);

    view.unmount();
    applyDelta(delta('member', 4), client);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
