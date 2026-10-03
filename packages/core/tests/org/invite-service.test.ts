import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { db, eq, schema } from '@gravity/db';
import { DomainError } from '@gravity/shared/errors';
import postgres from 'postgres';
import { ZodError } from 'zod';
import {
  acceptInvite,
  createInvite,
  createInvites,
  listPendingInvites,
  resendInvite,
  revokeInvite,
} from '../../src/org/invite-service.ts';
import { resolvePrincipal } from '../../src/org/member-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createUser, createWorkspace, resetDatabase } from '../../src/test-support.ts';

beforeEach(async () => {
  await resetDatabase();
  delete process.env['ALLOWED_EMAIL_DOMAINS'];
});

afterAll(async () => {
  await closeRealtime();
});

async function waitForLockWaiter(observer: postgres.Sql): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await observer<{ waiting: number }[]>`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the accept never waited on the workspace lock');
}

describe('invites', () => {
  test('an invited user joins with the invited role', async () => {
    const workspace = await createWorkspace();
    const invitee = await createUser('Aditi');
    const created = await createInvite(workspace.admin, { email: invitee.email, role: 'member' });
    await acceptInvite(created.token, invitee.id);
    const principal = await resolvePrincipal(invitee.id, workspace.organizationId);
    expect(principal.role).toBe('member');
  });

  test('a member cannot invite an admin', async () => {
    const workspace = await createWorkspace();
    const member = await createUser('Mo');
    const invite = await createInvite(workspace.admin, { email: member.email, role: 'member' });
    await acceptInvite(invite.token, member.id);
    const principal = await resolvePrincipal(member.id, workspace.organizationId);
    await expect(
      createInvite(principal, { email: 'x@gravity.test', role: 'admin' }),
    ).rejects.toThrow();
  });

  test('accepting records the member and the invitation under distinct sync ids', async () => {
    const workspace = await createWorkspace();
    const invitee = await createUser('Aditi');
    const created = await createInvite(workspace.admin, { email: invitee.email });
    const accepted = await acceptInvite(created.token, invitee.id);
    const syncIds = accepted.actions.map((action) => action.syncId);
    expect(accepted.actions.map((action) => action.model)).toEqual(['member', 'invitation']);
    expect(new Set(syncIds).size).toBe(2);
    const rows = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.organizationId, workspace.organizationId));
    for (const syncId of syncIds) expect(rows.map((row) => row.syncId)).toContain(syncId);
  });

  test('the announcement never carries the raw token', async () => {
    const workspace = await createWorkspace();
    const created = await createInvite(workspace.admin, { email: 'new@gravity.test' });
    const [row] = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.syncId, created.actions[0]?.syncId ?? -1));
    expect(JSON.stringify(row?.payload)).not.toContain(created.token);
  });

  test('a bulk invite gives each invitation its own outbox row', async () => {
    const workspace = await createWorkspace();
    const created = await createInvites(workspace.admin, {
      invites: [{ email: 'a@gravity.test' }, { email: 'b@gravity.test' }],
    });
    expect(created.actions).toHaveLength(2);
    const rows = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.organizationId, workspace.organizationId));
    expect(rows.filter((row) => created.actions.some((a) => a.syncId === row.syncId))).toHaveLength(
      2,
    );
  });

  test('re-inviting an address records a delete for the replaced row and an insert for the new one', async () => {
    const workspace = await createWorkspace();
    const first = await createInvite(workspace.admin, { email: 'again@gravity.test' });
    const second = await createInvite(workspace.admin, { email: 'again@gravity.test' });
    expect(second.actions.map((action) => action.action)).toEqual(['delete', 'insert']);
    expect(second.actions[0]?.modelId).toBe(first.actions[0]?.modelId);
    expect(second.actions[1]?.modelId).not.toBe(first.actions[0]?.modelId);
    const syncIds = second.actions.map((action) => action.syncId);
    expect(new Set(syncIds).size).toBe(2);
    const rows = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.organizationId, workspace.organizationId));
    for (const syncId of syncIds) expect(rows.map((row) => row.syncId)).toContain(syncId);
    const pending = await listPendingInvites(workspace.admin);
    expect(pending.map((invite) => invite.id)).toEqual([second.invitation.id]);
  });

  test('a batch with a duplicate address never creates then deletes its own invite', async () => {
    const workspace = await createWorkspace();
    const before = await db.select().from(schema.outbox);
    await expect(
      createInvites(workspace.admin, {
        invites: [{ email: 'Dup@gravity.test' }, { email: 'dup@gravity.test' }],
      }),
    ).rejects.toThrow(ZodError);
    expect(await listPendingInvites(workspace.admin)).toHaveLength(0);
    expect(await db.select().from(schema.outbox)).toHaveLength(before.length);
  });

  test('a revoked invite cannot be accepted', async () => {
    const workspace = await createWorkspace();
    const invitee = await createUser('Aditi');
    const created = await createInvite(workspace.admin, { email: invitee.email });
    await revokeInvite(workspace.admin, created.invitation.id);
    await expect(acceptInvite(created.token, invitee.id)).rejects.toThrow(DomainError);
    expect(await listPendingInvites(workspace.admin)).toHaveLength(0);
  });

  test('an invite revoked while an accept waits on the workspace lock is not accepted', async () => {
    const workspace = await createWorkspace();
    const invitee = await createUser('Aditi');
    const created = await createInvite(workspace.admin, { email: invitee.email });
    const rival = postgres(String(process.env['DATABASE_URL']), {
      max: 2,
      onnotice: () => undefined,
    });

    try {
      let releaseLock = (): void => undefined;
      const lockReleased = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let lockHeld = (): void => undefined;
      const lockTaken = new Promise<void>((resolve) => {
        lockHeld = resolve;
      });
      const holder = rival.begin(async (tx) => {
        await tx`select id from organization where id = ${workspace.organizationId} for update`;
        lockHeld();
        await lockReleased;
      });
      await lockTaken;

      const accepting = acceptInvite(created.token, invitee.id).then(
        () => 'accepted',
        (error: unknown) => (error instanceof DomainError ? error.code : 'unexpected'),
      );
      await waitForLockWaiter(rival);
      await rival`update invitation set status = 'revoked' where id = ${created.invitation.id} and status = 'pending'`;
      releaseLock();
      await holder;

      expect(await accepting).toBe('conflict');
    } finally {
      await rival.end();
    }

    const [row] = await db
      .select({ status: schema.invitation.status })
      .from(schema.invitation)
      .where(eq(schema.invitation.id, created.invitation.id));
    expect(row?.status).toBe('revoked');
    const joined = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.userId, invitee.id));
    expect(joined).toHaveLength(0);
  });

  test('an invite sent to another address is refused', async () => {
    const workspace = await createWorkspace();
    const stranger = await createUser('Stranger');
    const created = await createInvite(workspace.admin, { email: 'someone@gravity.test' });
    await expect(acceptInvite(created.token, stranger.id)).rejects.toThrow(DomainError);
  });

  test('a listed invite exposes neither the token nor its hash', async () => {
    const workspace = await createWorkspace();
    const created = await createInvite(workspace.admin, { email: 'listed@gravity.test' });
    const listed = JSON.stringify(await listPendingInvites(workspace.admin));
    const hash = createHash('sha256').update(created.token).digest('hex');
    expect(listed).not.toContain(created.token);
    expect(listed).not.toContain(hash);
    expect(JSON.stringify(created.invitation)).not.toContain(hash);
    expect(listed).toContain(created.invitation.id);
  });

  test('only the hash of the token is stored and the public id is not the token', async () => {
    const workspace = await createWorkspace();
    const created = await createInvite(workspace.admin, { email: 'stored@gravity.test' });
    const [row] = await db.select().from(schema.invitation);
    expect(row?.tokenHash).toBe(createHash('sha256').update(created.token).digest('hex'));
    expect(row?.id).toBe(created.invitation.id);
    expect(row?.id).not.toBe(created.token);
  });

  test('accepting with the token works and a wrong token or the public id does not', async () => {
    const workspace = await createWorkspace();
    const invitee = await createUser('Aditi');
    const created = await createInvite(workspace.admin, { email: invitee.email });
    await expect(acceptInvite('not-the-token', invitee.id)).rejects.toThrow(DomainError);
    await expect(acceptInvite(created.invitation.id, invitee.id)).rejects.toThrow(DomainError);
    await expect(resolvePrincipal(invitee.id, workspace.organizationId)).rejects.toThrow();
    const accepted = await acceptInvite(created.token, invitee.id);
    expect(accepted.alreadyAccepted).toBe(false);
    const principal = await resolvePrincipal(invitee.id, workspace.organizationId);
    expect(principal.role).toBe('member');
  });

  test('resending rotates the token so the old link stops working', async () => {
    const workspace = await createWorkspace();
    const invitee = await createUser('Aditi');
    const created = await createInvite(workspace.admin, { email: invitee.email });
    const resent = await resendInvite(workspace.admin, created.invitation.id);
    expect(resent.token).not.toBe(created.token);
    expect(resent.invitation.id).toBe(created.invitation.id);
    await expect(acceptInvite(created.token, invitee.id)).rejects.toThrow(DomainError);
    await acceptInvite(resent.token, invitee.id);
    const principal = await resolvePrincipal(invitee.id, workspace.organizationId);
    expect(principal.role).toBe('member');
  });
});
