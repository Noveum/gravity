import { and, asc, count, db, eq, isNull, ne, schema } from '@gravity/db';
import { conflict, forbidden } from '@gravity/shared/errors';
import type { SyncAction } from '@gravity/shared/events';
import { scopes } from '@gravity/shared/events';
import type { Principal } from '@gravity/shared/policy';
import { assertCan, canAssignRole, policyRole } from '@gravity/shared/policy';
import { memberUpdateSchema } from '@gravity/shared/validators';
import { principalActor } from '../actor.ts';
import { cappedTransaction } from '../crm/sync-batch.ts';
import { type Executor, requireRow } from '../internal.ts';
import { recordSync } from '../realtime/outbox.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';
import type { MemberRow } from './organization-service.ts';

export interface MemberWithUser {
  readonly member: MemberRow;
  readonly user: Pick<
    typeof schema.user.$inferSelect,
    'id' | 'name' | 'email' | 'image' | 'handle'
  >;
}

export async function findPrincipal(
  userId: string,
  organizationId: string,
  executor: Executor = db,
): Promise<Principal | null> {
  const [membership] = await executor
    .select({ role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.userId, userId),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .limit(1);
  if (membership === undefined) return null;
  return { userId, organizationId, role: policyRole(membership.role) };
}

export async function resolvePrincipal(
  userId: string,
  organizationId: string,
  executor: Executor = db,
): Promise<Principal> {
  const principal = await findPrincipal(userId, organizationId, executor);
  if (principal === null) throw forbidden('You are not a member of this workspace.');
  return principal;
}

export async function listMembers(principal: Principal): Promise<MemberWithUser[]> {
  const rows = await db
    .select({
      member: schema.member,
      user: {
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
        handle: schema.user.handle,
      },
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, principal.organizationId))
    .orderBy(asc(schema.user.name));
  return rows;
}

export async function getMember(principal: Principal, memberId: string): Promise<MemberRow> {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.id, memberId),
        eq(schema.member.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  return requireRow(row, 'That member does not exist.');
}

async function countOtherAdmins(
  executor: Executor,
  organizationId: string,
  excludingMemberId: string,
): Promise<number> {
  const [row] = await executor
    .select({ total: count() })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.role, 'admin'),
        ne(schema.member.id, excludingMemberId),
      ),
    );
  return row?.total ?? 0;
}

export async function updateMemberRole(
  principal: Principal,
  memberId: string,
  input: unknown,
): Promise<{ member: MemberRow; actions: SyncAction[] }> {
  assertCan(principal, 'member:manage');
  const parsed = memberUpdateSchema.parse(input);
  if (parsed.role !== undefined && !canAssignRole(principal, parsed.role)) {
    throw forbidden('Only admins can change roles.');
  }

  return await cappedTransaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.id, memberId),
          eq(schema.member.organizationId, principal.organizationId),
        ),
      )
      .limit(1)
      .for('update');
    const current = requireRow(existing, 'That member does not exist.');

    if (current.role === 'admin' && parsed.role !== undefined && parsed.role !== 'admin') {
      const others = await countOtherAdmins(tx, principal.organizationId, memberId);
      if (others === 0) throw conflict('A workspace needs at least one admin.');
    }

    const syncId = await nextSyncId(tx);
    const [updated] = await tx
      .update(schema.member)
      .set({ ...parsed, syncId })
      .where(eq(schema.member.id, memberId))
      .returning();
    const member = requireRow(updated, 'That member does not exist.');

    const actions = [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: [scopes.workspace(principal.organizationId), scopes.user(member.userId)],
        action: 'update',
        model: 'member',
        modelId: member.id,
        data: member,
        actor: principalActor(principal),
      }),
    ];
    await recordSync(tx, actions);

    return { member, actions };
  });
}

export async function removeMember(
  principal: Principal,
  memberId: string,
): Promise<{ actions: SyncAction[] }> {
  assertCan(principal, 'member:manage');

  return await cappedTransaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.id, memberId),
          eq(schema.member.organizationId, principal.organizationId),
        ),
      )
      .limit(1)
      .for('update');
    const current = requireRow(existing, 'That member does not exist.');

    if (current.role === 'admin') {
      const others = await countOtherAdmins(tx, principal.organizationId, memberId);
      if (others === 0) throw conflict('A workspace needs at least one admin.');
    }

    const syncId = await nextSyncId(tx);
    await tx.delete(schema.member).where(eq(schema.member.id, memberId));
    await tx.delete(schema.session).where(eq(schema.session.userId, current.userId));

    const actions = [
      buildSyncAction({
        syncId,
        organizationId: principal.organizationId,
        scopes: [scopes.workspace(principal.organizationId), scopes.user(current.userId)],
        action: 'delete',
        model: 'member',
        modelId: memberId,
        data: { id: memberId, userId: current.userId },
        actor: principalActor(principal),
      }),
    ];
    await recordSync(tx, actions);

    return { actions };
  });
}
