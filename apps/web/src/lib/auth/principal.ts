import { selectActiveMembership } from '@gravity/core';
import { db, eq, schema } from '@gravity/db';
import { ORG_ROLES, type OrgRole } from '@gravity/shared/constants';
import type { Principal } from '@gravity/shared/policy';

function toOrgRole(value: string): OrgRole {
  const match = ORG_ROLES.find((role) => role === value);
  return match ?? 'guest';
}

export interface MembershipContext {
  readonly principal: Principal;
  readonly memberId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly deletionRequestedAt: Date | null;
}

export async function resolveMembership(
  userId: string,
  organizationId: string | null,
): Promise<MembershipContext | null> {
  const memberships = await db
    .select({
      memberId: schema.member.id,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      organizationId: schema.organization.id,
      organizationName: schema.organization.name,
      organizationSlug: schema.organization.slug,
      deletionRequestedAt: schema.organization.deletionRequestedAt,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId));

  const row = selectActiveMembership(memberships, organizationId);
  if (row === undefined) return null;

  return {
    memberId: row.memberId,
    organizationName: row.organizationName,
    organizationSlug: row.organizationSlug,
    deletionRequestedAt: row.deletionRequestedAt,
    principal: {
      userId,
      organizationId: row.organizationId,
      role: toOrgRole(row.role),
    },
  };
}
