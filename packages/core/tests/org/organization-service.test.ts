import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { db, eq, schema } from '@gravity/db';
import { DomainError } from '@gravity/shared/errors';
import { verifyMcpAccessToken } from '../../src/auth/mcp-token.ts';
import { acceptInvite, createInvite } from '../../src/org/invite-service.ts';
import {
  listMembers,
  removeMember,
  resolvePrincipal,
  updateMemberRole,
} from '../../src/org/member-service.ts';
import {
  assertEmailDomainAllowed,
  createOrganization,
  updateOrganization,
} from '../../src/org/organization-service.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import {
  createUser,
  createWorkspace,
  mintMcpToken,
  resetDatabase,
} from '../../src/test-support.ts';

beforeEach(async () => {
  await resetDatabase();
  delete process.env['ALLOWED_EMAIL_DOMAINS'];
});

afterAll(async () => {
  await closeRealtime();
});

describe('createOrganization', () => {
  test('creates the workspace, an admin member and outbox rows in one go', async () => {
    const user = await createUser('Ada');
    const created = await createOrganization(user.id, { name: 'Acme', slug: 'acme' });
    const principal = await resolvePrincipal(user.id, created.organization.id);
    expect(principal.role).toBe('admin');
    const rows = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.organizationId, created.organization.id));
    expect(rows.length).toBe(created.actions.length);
    expect(rows.length).toBeGreaterThan(0);
  });

  test('gives every action its own sync id and stamps it on its row', async () => {
    const user = await createUser('Ada');
    const created = await createOrganization(user.id, { name: 'Acme', slug: 'acme' });
    const syncIds = created.actions.map((action) => action.syncId);
    expect(new Set(syncIds).size).toBe(syncIds.length);
    expect(created.actions.map((action) => [action.model, action.syncId])).toEqual([
      ['organization', created.organization.syncId],
      ['member', created.member.syncId],
    ]);
  });

  test('refuses a taken slug', async () => {
    const user = await createUser('Ada');
    await createOrganization(user.id, { name: 'Acme', slug: 'acme' });
    await expect(createOrganization(user.id, { name: 'Acme 2', slug: 'acme' })).rejects.toThrow(
      DomainError,
    );
  });

  test('a taken slug leaves no outbox row behind', async () => {
    const user = await createUser('Ada');
    await createOrganization(user.id, { name: 'Acme', slug: 'acme' });
    const before = await db.select().from(schema.outbox);
    await createOrganization(user.id, { name: 'Acme 2', slug: 'acme' }).catch(() => undefined);
    expect(await db.select().from(schema.outbox)).toHaveLength(before.length);
  });
});

describe('updateOrganization', () => {
  test('an admin renames the workspace and the change reaches the outbox', async () => {
    const workspace = await createWorkspace();
    const updated = await updateOrganization(workspace.admin, { name: 'Acme Two' });
    expect(updated.organization.name).toBe('Acme Two');
    const rows = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.syncId, updated.actions[0]?.syncId ?? -1));
    expect(rows).toHaveLength(1);
  });

  test('a member cannot manage the workspace', async () => {
    const workspace = await createWorkspace();
    const member = await createUser('Mo');
    const invite = await createInvite(workspace.admin, { email: member.email, role: 'member' });
    await acceptInvite(invite.token, member.id);
    const principal = await resolvePrincipal(member.id, workspace.organizationId);
    await expect(updateOrganization(principal, { name: 'Hijacked' })).rejects.toThrow(DomainError);
  });
});

describe('members', () => {
  test('the last admin cannot be demoted or removed', async () => {
    const workspace = await createWorkspace();
    const members = await listMembers(workspace.admin);
    const own = members[0]?.member;
    expect(own?.role).toBe('admin');
    await expect(
      updateMemberRole(workspace.admin, own?.id ?? '', { role: 'member' }),
    ).rejects.toThrow(DomainError);
    await expect(removeMember(workspace.admin, own?.id ?? '')).rejects.toThrow(DomainError);
  });

  test('removing a member records a delete action and drops their membership', async () => {
    const workspace = await createWorkspace();
    const joiner = await createUser('Mo');
    const invite = await createInvite(workspace.admin, { email: joiner.email, role: 'member' });
    const accepted = await acceptInvite(invite.token, joiner.id);
    const removed = await removeMember(workspace.admin, accepted.member.id);
    expect(removed.actions.map((action) => action.action)).toEqual(['delete']);
    const rows = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.syncId, removed.actions[0]?.syncId ?? -1));
    expect(rows).toHaveLength(1);
    await expect(resolvePrincipal(joiner.id, workspace.organizationId)).rejects.toThrow(
      DomainError,
    );
  });

  test('removing a member revokes their MCP connections to that workspace, even after a re-invite', async () => {
    const workspace = await createWorkspace();
    const elsewhere = await createWorkspace('Elsewhere');
    const joiner = await createUser('Mo');
    const invite = await createInvite(workspace.admin, { email: joiner.email, role: 'member' });
    const accepted = await acceptInvite(invite.token, joiner.id);
    const outside = await createInvite(elsewhere.admin, { email: joiner.email, role: 'member' });
    await acceptInvite(outside.token, joiner.id);
    const here = await mintMcpToken(workspace.organizationId, joiner.id);
    const there = await mintMcpToken(elsewhere.organizationId, joiner.id);
    await removeMember(workspace.admin, accepted.member.id);
    const again = await createInvite(workspace.admin, { email: joiner.email, role: 'member' });
    await acceptInvite(again.token, joiner.id);
    await expect(verifyMcpAccessToken(here.token)).rejects.toMatchObject({ code: 'unauthorized' });
    const tokens = await db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.clientId, here.clientId));
    expect(tokens).toHaveLength(0);
    expect((await verifyMcpAccessToken(there.token)).organizationId).toBe(elsewhere.organizationId);
  });
});

describe('assertEmailDomainAllowed', () => {
  test('refuses an address outside the allowlist', () => {
    process.env['ALLOWED_EMAIL_DOMAINS'] = 'acme.com';
    expect(() => assertEmailDomainAllowed('mallory@evil.test')).toThrow(DomainError);
    expect(() => assertEmailDomainAllowed('ada@acme.com')).not.toThrow();
  });

  test('a workspace allowlist narrows further', () => {
    expect(() =>
      assertEmailDomainAllowed('ada@acme.com', { allowedEmailDomains: ['other.com'] }),
    ).toThrow(DomainError);
  });
});
