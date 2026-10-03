import { beforeEach, describe, expect, mock, test } from 'bun:test';
import * as core from '@gravity/core';
import { createInvite } from '@gravity/core';
import { createUser, createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db, eq, schema } from '@gravity/db';
import { restoreModulesAfterThisFile, signedInAs } from '../../../../tests-support.ts';

await restoreModulesAfterThisFile(['@gravity/core']);

const revoked: string[] = [];
mock.module('@gravity/core', () => ({
  ...core,
  publishSessionRevoked: (userId: string) => {
    revoked.push(userId);
    return Promise.resolve();
  },
}));

const { DELETE, PATCH } = await import('@/app/api/members/[id]/route.ts');

async function addMember(organizationId: string, adminId: string, role: string) {
  const user = await createUser('Casey');
  const principal = { userId: adminId, organizationId, role: 'admin' } as const;
  const { token } = await createInvite(principal, { email: user.email, role });
  await core.acceptInvite(token, user.id);
  const [row] = await db.select().from(schema.member).where(eq(schema.member.userId, user.id));
  if (row === undefined) throw new Error('member missing');
  return { user, memberId: row.id };
}

function call(method: 'PATCH' | 'DELETE', id: string, body?: unknown): Promise<Response> {
  const request = new Request(`http://localhost:3300/api/members/${id}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const context = { params: Promise.resolve({ id }) };
  return method === 'PATCH' ? PATCH(request, context) : DELETE(request, context);
}

beforeEach(async () => {
  await resetDatabase();
  revoked.length = 0;
});

describe('/api/members/:id', () => {
  test('an admin changes a member role', async () => {
    const workspace = await createWorkspace();
    const member = await addMember(workspace.organizationId, workspace.adminUser.id, 'member');
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const response = await call('PATCH', member.memberId, { role: 'guest' });
    expect(response.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.id, member.memberId));
    expect(row?.role).toBe('guest');
  });

  test('a member cannot change roles', async () => {
    const workspace = await createWorkspace();
    const member = await addMember(workspace.organizationId, workspace.adminUser.id, 'member');
    await signedInAs(member.user.id, workspace.organizationId);
    const response = await call('PATCH', member.memberId, { role: 'admin' });
    expect(response.status).toBe(403);
  });

  test('removing a member deletes their sessions and revokes their sockets', async () => {
    const workspace = await createWorkspace();
    const member = await addMember(workspace.organizationId, workspace.adminUser.id, 'member');
    await signedInAs(member.user.id, workspace.organizationId);
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const response = await call('DELETE', member.memberId);
    expect(response.status).toBe(200);
    expect(revoked).toEqual([member.user.id]);
    expect(
      await db.select().from(schema.session).where(eq(schema.session.userId, member.user.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.member).where(eq(schema.member.id, member.memberId)),
    ).toHaveLength(0);
  });

  test('the last admin cannot be removed and nobody is revoked', async () => {
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const [row] = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, workspace.adminUser.id));
    const response = await call('DELETE', row?.id ?? '');
    expect(response.status).toBe(409);
    expect(revoked).toEqual([]);
  });
});
