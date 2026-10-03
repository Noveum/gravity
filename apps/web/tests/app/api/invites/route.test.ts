import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createUser, createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db, schema } from '@gravity/db';
import { DELETE as revoke } from '@/app/api/invites/[id]/route.ts';
import { POST as accept } from '@/app/api/invites/accept/[token]/route.ts';
import { POST as invite, GET as pending } from '@/app/api/invites/route.ts';
import { GET as members } from '@/app/api/members/route.ts';
import { signedInAs } from '../../../../tests-support.ts';

const savedDevLogin = process.env['GRAVITY_DEV_LOGIN'];

beforeEach(async () => {
  await resetDatabase();
  process.env['RESEND_API_KEY'] = '';
  process.env['GRAVITY_DEV_LOGIN'] = 'true';
});

afterEach(() => {
  if (savedDevLogin === undefined) delete process.env['GRAVITY_DEV_LOGIN'];
  else process.env['GRAVITY_DEV_LOGIN'] = savedDevLogin;
});

function inviteRequest(email: string): Request {
  return new Request('http://localhost:3300/api/invites', {
    method: 'POST',
    body: JSON.stringify({ email, role: 'member' }),
  });
}

function acceptRequest(token: string): [Request, { params: Promise<{ token: string }> }] {
  return [
    new Request(`http://localhost:3300/api/invites/accept/${token}`, { method: 'POST' }),
    { params: Promise.resolve({ token }) },
  ];
}

describe('invite flow', () => {
  test('an admin invites, the invitee accepts and appears in members', async () => {
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const invitee = await createUser('Aditi');
    const created = await invite(
      new Request('http://localhost:3300/api/invites', {
        method: 'POST',
        body: JSON.stringify({ email: invitee.email, role: 'member' }),
      }),
    );
    expect(created.status).toBe(200);
    const { token } = (await created.json()) as { token: string };

    await signedInAs(invitee.id);
    const accepted = await accept(
      new Request(`http://localhost:3300/api/invites/accept/${token}`, { method: 'POST' }),
      { params: Promise.resolve({ token }) },
    );
    expect(accepted.status).toBe(200);

    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const listed = await (await members(new Request('http://localhost:3300/api/members'))).json();
    expect(listed.members.map((row: { user: { id: string } }) => row.user.id)).toContain(
      invitee.id,
    );
  });
});

describe('invite preflight', () => {
  test('refuses to create an invite nobody can receive', async () => {
    process.env['GRAVITY_DEV_LOGIN'] = 'false';
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const response = await invite(inviteRequest('teammate@gravity.test'));
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain('Email delivery is unavailable');
    expect(await db.select().from(schema.invitation)).toHaveLength(0);
  });

  test('rejects an anonymous request before revealing configuration', async () => {
    process.env['GRAVITY_DEV_LOGIN'] = 'false';
    const response = await invite(inviteRequest('teammate@gravity.test'));
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain('RESEND_API_KEY');
  });

  test('lists pending invites with their email and role', async () => {
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const created = await invite(inviteRequest('teammate@gravity.test'));
    const { token } = (await created.json()) as { token: string };
    const listed = await (await pending(new Request('http://localhost:3300/api/invites'))).json();
    expect(listed.invites).toHaveLength(1);
    expect(listed.invites[0]).toMatchObject({ email: 'teammate@gravity.test', role: 'member' });
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify(listed).toLowerCase()).not.toContain('hash');
  });
});

describe('invite acceptance', () => {
  test('a revoked invite can no longer be accepted', async () => {
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const invitee = await createUser('Aditi');
    const created = await invite(inviteRequest(invitee.email));
    const { token, invitation } = (await created.json()) as {
      token: string;
      invitation: { id: string };
    };

    const revoked = await revoke(new Request('http://localhost:3300/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: invitation.id }),
    });
    expect(revoked.status).toBe(200);

    await signedInAs(invitee.id);
    const accepted = await accept(...acceptRequest(token));
    expect(accepted.status).toBe(409);
  });

  test('an invite sent to someone else cannot be accepted by another account', async () => {
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const invitee = await createUser('Aditi');
    const stranger = await createUser('Sam');
    const created = await invite(inviteRequest(invitee.email));
    const { token } = (await created.json()) as { token: string };

    await signedInAs(stranger.id);
    const accepted = await accept(...acceptRequest(token));
    expect(accepted.status).toBe(409);
    expect(await db.select().from(schema.member)).toHaveLength(1);
  });

  test('accepting makes the new workspace the session workspace', async () => {
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const invitee = await createUser('Aditi');
    const created = await invite(inviteRequest(invitee.email));
    const { token } = (await created.json()) as { token: string };

    await signedInAs(invitee.id);
    await accept(...acceptRequest(token));
    const listed = await (await members(new Request('http://localhost:3300/api/members'))).json();
    expect(listed.members).toHaveLength(2);
  });
});
