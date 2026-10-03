import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { render, screen } from '@testing-library/react';
import type { ActiveSession } from '@/lib/auth/session.ts';
import {
  activeSessionFor,
  mockSession,
  restoreModulesAfterThisFile,
} from '../../../../../tests-support.ts';

await restoreModulesAfterThisFile(['next/navigation']);

mock.module('next/navigation', () => ({
  usePathname: () => '/settings/members',
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock(), prefetch: mock() }),
  redirect: (destination: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${destination}` });
  },
  notFound: mock(),
}));

let current: ActiveSession | null = null;
mockSession(() => current);

const { default: MembersSettingsPage } = await import('@/app/(app)/settings/members/page.tsx');

beforeEach(async () => {
  await resetDatabase();
});

describe('members settings page', () => {
  test('renders the members of an active workspace', async () => {
    const workspace = await createWorkspace();
    current = activeSessionFor(workspace.adminUser, workspace.organizationId);
    render(await MembersSettingsPage());
    expect(screen.getByText(workspace.adminUser.name)).toBeInTheDocument();
  });

  test('renders for a workspace being deleted instead of redirecting back to itself', async () => {
    const workspace = await createWorkspace();
    await db.update(schema.organization).set({ deletionRequestedAt: new Date() });
    current = activeSessionFor(workspace.adminUser, workspace.organizationId);
    render(await MembersSettingsPage());
    expect(screen.getByText(workspace.adminUser.name)).toBeInTheDocument();
  });
});
