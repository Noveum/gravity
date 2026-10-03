import { beforeEach, describe, expect, test } from 'bun:test';
import { createOrganization } from '@gravity/core';
import { createWorkspace, resetDatabase } from '@gravity/core/test-support';
import type { ActiveSession } from '@/lib/auth/session.ts';
import { mockSession } from '../../../tests-support.ts';

let current: ActiveSession | null = null;
mockSession(() => current);

const { apiContext } = await import('@/lib/api/handler.ts');

function sessionFor(
  user: { id: string; name: string; email: string },
  activeOrganizationId?: string,
): ActiveSession {
  const now = new Date();
  return {
    session: {
      id: 'session-1',
      token: 'token-1',
      userId: user.id,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      ...(activeOrganizationId === undefined ? {} : { activeOrganizationId }),
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

beforeEach(async () => {
  await resetDatabase();
  current = null;
});

describe('apiContext', () => {
  test('rejects a request without a session', async () => {
    await expect(apiContext()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  test('rejects a user who belongs to no workspace', async () => {
    const workspace = await createWorkspace('Solo');
    await createOrganization(workspace.adminUser.id, { name: 'Other', slug: 'other-space' });
    current = sessionFor({ id: 'nobody', name: 'Nobody', email: 'nobody@acme.com' });
    await expect(apiContext()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  test('uses the active organization carried by the session', async () => {
    const first = await createWorkspace('First');
    const second = await createOrganization(first.adminUser.id, {
      name: 'Second',
      slug: 'second-space',
    });
    current = sessionFor(first.adminUser, second.organization.id);
    const context = await apiContext();
    expect(context.principal.organizationId).toBe(second.organization.id);
    expect(context.principal.role).toBe('admin');
    expect(context.organizationSlug).toBe('second-space');
  });

  test('falls back to the oldest membership and carries no team ids', async () => {
    const first = await createWorkspace('First');
    await createOrganization(first.adminUser.id, { name: 'Second', slug: 'second-space' });
    current = sessionFor(first.adminUser);
    const context = await apiContext();
    expect(context.principal.organizationId).toBe(first.organizationId);
    expect(Object.keys(context.principal).sort()).toEqual(['organizationId', 'role', 'userId']);
  });
});
