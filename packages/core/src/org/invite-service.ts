import { createHash } from 'node:crypto';
import { and, asc, db, eq, gt, isNull, schema, sql } from '@gravity/db';
import { conflict, forbidden, notFound } from '@gravity/shared/errors';
import type { SyncAction } from '@gravity/shared/events';
import { scopes } from '@gravity/shared/events';
import type { Principal } from '@gravity/shared/policy';
import {
  assertCan,
  assertVerifiedEmailForInvitation,
  canAssignRole,
  policyRole,
} from '@gravity/shared/policy';
import { inviteBulkSchema, inviteCreateSchema } from '@gravity/shared/validators';
import { principalActor } from '../actor.ts';
import { addUtcDays, type Executor, newId, newToken, requireRow } from '../internal.ts';
import { recordSync } from '../realtime/outbox.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import { lockOrganization } from './organization-lock.ts';
import { assertEmailDomainAllowed, type MemberRow } from './organization-service.ts';

export type InvitationRow = typeof schema.invitation.$inferSelect;

export const INVITE_TTL_DAYS = 14;

export interface CreatedInvite {
  readonly invitation: InvitationRow;
  readonly token: string;
}

async function assertEmailIsFree(
  executor: Executor,
  organizationId: string,
  email: string,
): Promise<void> {
  const [existing] = await executor
    .select({ id: schema.member.id })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.user.email, email)))
    .limit(1);
  if (existing !== undefined) throw conflict(`${email} is already a member.`);
}

function assertCanInviteRole(actor: Principal, role: string): void {
  if (role === 'admin' && !canAssignRole(actor, 'admin')) {
    throw forbidden('Only admins can invite admins.', { details: { role } });
  }
}

async function insertInvite(
  executor: Executor,
  principal: Principal,
  params: {
    organizationId: string;
    inviterId: string;
    email: string;
    role: string;
    now: Date;
    syncId: number;
  },
): Promise<InvitationRow> {
  assertCanInviteRole(principal, params.role);
  const [organization] = await executor
    .select({ allowedEmailDomains: schema.organization.allowedEmailDomains })
    .from(schema.organization)
    .where(eq(schema.organization.id, params.organizationId))
    .limit(1);
  assertEmailDomainAllowed(params.email, organization ?? null);

  await executor
    .delete(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, params.organizationId),
        eq(schema.invitation.email, params.email),
        eq(schema.invitation.status, 'pending'),
      ),
    );
  const [row] = await executor
    .insert(schema.invitation)
    .values({
      id: newToken(),
      organizationId: params.organizationId,
      email: params.email,
      role: params.role,
      status: 'pending',
      inviterId: params.inviterId,
      expiresAt: addUtcDays(params.now, INVITE_TTL_DAYS),
      syncId: params.syncId,
    })
    .returning();
  return requireRow(row, 'The invite could not be created.');
}

export function inviteReference(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

export function inviteAnnouncement(invitation: InvitationRow): Record<string, unknown> {
  return {
    id: inviteReference(invitation.id),
    organizationId: invitation.organizationId,
    status: invitation.status,
    syncId: invitation.syncId,
    createdAt: invitation.createdAt,
  };
}

function inviteAction(
  invitation: InvitationRow,
  syncId: number,
  actor: Parameters<typeof buildSyncAction>[0]['actor'],
  action: 'insert' | 'update' | 'delete',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: invitation.organizationId,
    scopes: [scopes.workspace(invitation.organizationId)],
    action,
    model: 'invitation',
    modelId: inviteReference(invitation.id),
    data: inviteAnnouncement(invitation),
    actor,
  });
}

export async function createInvite(
  principal: Principal,
  input: unknown,
): Promise<{ invitation: InvitationRow; token: string; actions: SyncAction[] }> {
  assertCan(principal, 'member:invite');
  const parsed = inviteCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    await assertEmailIsFree(tx, principal.organizationId, parsed.email);
    const syncId = await nextSyncId(tx);
    const actor = principalActor(principal);
    const invitation = await insertInvite(tx, principal, {
      organizationId: principal.organizationId,
      inviterId: principal.userId,
      email: parsed.email,
      role: parsed.role,
      now: new Date(),
      syncId,
    });
    const actions = [inviteAction(invitation, syncId, actor, 'insert')];
    await recordSync(tx, actions);
    return { invitation, token: invitation.id, actions };
  });
}

export async function createInvites(
  principal: Principal,
  input: unknown,
): Promise<{ invites: CreatedInvite[]; actions: SyncAction[] }> {
  assertCan(principal, 'member:invite');
  const parsed = inviteBulkSchema.parse(input);

  return await db.transaction(async (tx) => {
    const actor = principalActor(principal);
    const now = new Date();
    const invites: CreatedInvite[] = [];
    const actions: SyncAction[] = [];
    for (const entry of parsed.invites) {
      await assertEmailIsFree(tx, principal.organizationId, entry.email);
      const syncId = await nextSyncId(tx);
      const invitation = await insertInvite(tx, principal, {
        organizationId: principal.organizationId,
        inviterId: principal.userId,
        email: entry.email,
        role: entry.role,
        now,
        syncId,
      });
      invites.push({ invitation, token: invitation.id });
      actions.push(inviteAction(invitation, syncId, actor, 'insert'));
    }
    await recordSync(tx, actions);
    return { invites, actions };
  });
}

export interface PendingInviteForUser {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly role: string;
}

export async function pendingInvitesForEmail(email: string): Promise<PendingInviteForUser[]> {
  const rows = await db
    .select({
      id: schema.invitation.id,
      organizationId: schema.organization.id,
      organizationName: schema.organization.name,
      organizationSlug: schema.organization.slug,
      role: schema.invitation.role,
    })
    .from(schema.invitation)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
    .where(
      and(
        eq(sql`lower(${schema.invitation.email})`, email.toLowerCase()),
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, new Date()),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .orderBy(asc(schema.invitation.createdAt));
  return rows;
}

export async function listPendingInvites(principal: Principal): Promise<InvitationRow[]> {
  assertCan(principal, 'member:invite');
  return await db
    .select()
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, principal.organizationId),
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(schema.invitation.createdAt));
}

export async function revokeInvite(
  principal: Principal,
  inviteId: string,
): Promise<{ invitation: InvitationRow; actions: SyncAction[] }> {
  assertCan(principal, 'member:invite');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = principalActor(principal);
    const [updated] = await tx
      .update(schema.invitation)
      .set({ status: 'revoked', syncId })
      .where(
        and(
          eq(schema.invitation.id, inviteId),
          eq(schema.invitation.organizationId, principal.organizationId),
          eq(schema.invitation.status, 'pending'),
        ),
      )
      .returning();
    const invitation = requireRow(updated, 'That invite is no longer pending.');
    const actions = [inviteAction(invitation, syncId, actor, 'delete')];
    await recordSync(tx, actions);
    return { invitation, actions };
  });
}

export async function resendInvite(
  principal: Principal,
  inviteId: string,
): Promise<{ invitation: InvitationRow; token: string; actions: SyncAction[] }> {
  assertCan(principal, 'member:invite');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = principalActor(principal);
    const [updated] = await tx
      .update(schema.invitation)
      .set({ expiresAt: addUtcDays(new Date(), INVITE_TTL_DAYS), syncId })
      .where(
        and(
          eq(schema.invitation.id, inviteId),
          eq(schema.invitation.organizationId, principal.organizationId),
          eq(schema.invitation.status, 'pending'),
        ),
      )
      .returning();
    const invitation = requireRow(updated, 'That invite is no longer pending.');
    const actions = [inviteAction(invitation, syncId, actor, 'update')];
    await recordSync(tx, actions);
    return { invitation, token: invitation.id, actions };
  });
}

export interface AcceptedInvite {
  readonly member: MemberRow;
  readonly organizationId: string;
  readonly alreadyAccepted: boolean;
  readonly actions: SyncAction[];
}

export async function acceptInvite(token: string, userId: string): Promise<AcceptedInvite> {
  return await db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.id, token))
      .limit(1);
    const invitation = requireRow(found, 'That invite is not valid.');
    const organization = await lockOrganization(tx, invitation.organizationId);
    if (organization.deletionRequestedAt !== null) {
      throw conflict('That workspace is being permanently deleted.');
    }

    const [existingMember] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, invitation.organizationId),
          eq(schema.member.userId, userId),
        ),
      )
      .limit(1);

    if (existingMember !== undefined) {
      return {
        member: existingMember,
        organizationId: invitation.organizationId,
        alreadyAccepted: true,
        actions: [],
      };
    }

    if (invitation.status !== 'pending') throw conflict('That invite is no longer available.');
    if (invitation.expiresAt.getTime() < Date.now()) throw conflict('That invite has expired.');

    const [inviter] = await tx
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, invitation.organizationId),
          eq(schema.member.userId, invitation.inviterId),
        ),
      )
      .limit(1);
    assertCanInviteRole(
      {
        userId: invitation.inviterId,
        organizationId: invitation.organizationId,
        role: policyRole(inviter?.role ?? 'guest'),
      },
      invitation.role,
    );

    const [invitedUser] = await tx
      .select({
        email: schema.user.email,
        name: schema.user.name,
        emailVerified: schema.user.emailVerified,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (invitedUser === undefined) throw notFound('That account does not exist.');
    if (invitedUser.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw conflict('That invite was sent to a different email address.');
    }
    assertVerifiedEmailForInvitation(invitedUser.emailVerified);

    const memberSyncId = await nextSyncId(tx);
    const invitationSyncId = await nextSyncId(tx);
    const [created] = await tx
      .insert(schema.member)
      .values({
        id: newId(),
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
        syncId: memberSyncId,
      })
      .returning();
    const member = requireRow(created, 'The membership could not be created.');

    const [acceptedInvitation] = await tx
      .update(schema.invitation)
      .set({ status: 'accepted', syncId: invitationSyncId })
      .where(eq(schema.invitation.id, invitation.id))
      .returning();

    const actor = { type: 'user', id: userId, name: invitedUser.name } as const;
    const actions = [
      buildSyncAction({
        syncId: memberSyncId,
        organizationId: invitation.organizationId,
        scopes: [scopes.workspace(invitation.organizationId), scopes.user(userId)],
        action: 'insert',
        model: 'member',
        modelId: member.id,
        data: member,
        actor,
      }),
      ...(acceptedInvitation === undefined
        ? []
        : [inviteAction(acceptedInvitation, invitationSyncId, actor, 'update')]),
    ];
    await recordSync(tx, actions);

    return {
      member,
      organizationId: invitation.organizationId,
      alreadyAccepted: false,
      actions,
    };
  });
}

export { matchAllowedDomain } from './organization-service.ts';
