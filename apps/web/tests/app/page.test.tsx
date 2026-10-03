import { beforeEach, describe, expect, test } from 'bun:test';
import type { ActiveSession } from '@/lib/auth/session.ts';
import { mockSession } from '../../tests-support.ts';

let current: ActiveSession | null = null;
mockSession(() => current);

const { default: Home } = await import('@/app/page.tsx');

beforeEach(() => {
  current = null;
});

describe('home', () => {
  test('sends a visitor to the login page', async () => {
    await expect(Home()).rejects.toMatchObject({ digest: expect.stringContaining('/login') });
  });

  test('sends a signed in user to today', async () => {
    const now = new Date();
    current = {
      session: {
        id: 's1',
        token: 't1',
        userId: 'u1',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
      user: {
        id: 'u1',
        name: 'Ada',
        email: 'ada@acme.test',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    };
    await expect(Home()).rejects.toMatchObject({ digest: expect.stringContaining('/today') });
  });
});
