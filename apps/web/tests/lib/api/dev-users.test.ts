import { beforeEach, describe, expect, test } from 'bun:test';
import { createUser, createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { listDevUsers } from '@/lib/api/dev-users.ts';

beforeEach(async () => {
  await resetDatabase();
});

describe('listDevUsers', () => {
  test('lists members first and still offers users who have no workspace yet', async () => {
    const orphan = await createUser('Zed');
    const workspace = await createWorkspace();
    const users = await listDevUsers();
    expect(users.map((user) => user.email)).toEqual([workspace.adminUser.email, orphan.email]);
  });
});
