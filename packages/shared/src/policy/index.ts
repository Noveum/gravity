import { GRAVITY_WRITE_SCOPE, ORG_ROLE_RANK, ORG_ROLES, type OrgRole } from '../constants/index.ts';
import { forbidden } from '../errors/index.ts';

export const PERMISSIONS = [
  'record:read',
  'record:write',
  'record:delete',
  'view:manage',
  'import:run',
  'pipeline:manage',
  'field:manage',
  'member:invite',
  'member:manage',
  'integration:manage',
  'workspace:manage',
  'workspace:delete',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const GUEST: readonly Permission[] = ['record:read'];

const CONTRIBUTOR: readonly Permission[] = [...GUEST, 'record:write', 'view:manage'];

const MEMBER: readonly Permission[] = [
  ...CONTRIBUTOR,
  'record:delete',
  'import:run',
  'pipeline:manage',
  'field:manage',
  'member:invite',
];

const ADMIN: readonly Permission[] = [
  ...MEMBER,
  'member:manage',
  'integration:manage',
  'workspace:manage',
  'workspace:delete',
];

const PERMISSIONS_BY_ROLE: Readonly<Record<OrgRole, readonly Permission[]>> = {
  guest: GUEST,
  contributor: CONTRIBUTOR,
  member: MEMBER,
  admin: ADMIN,
};

export interface Principal {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: OrgRole;
}

export function permissionsFor(role: OrgRole): readonly Permission[] {
  return PERMISSIONS_BY_ROLE[role];
}

export function policyRole(role: string): OrgRole {
  return ORG_ROLES.find((candidate) => candidate === role) ?? 'guest';
}

export function can(principal: Principal, permission: Permission): boolean {
  return permissionsFor(principal.role).includes(permission);
}

export function assertCan(principal: Principal, permission: Permission): void {
  if (!can(principal, permission)) {
    throw forbidden(`Your role cannot ${permission.replace(':', ' ')}.`, {
      details: { permission, role: principal.role },
    });
  }
}

export function usableMcpScopes(role: OrgRole, scopes: readonly string[]): string[] {
  const writes = permissionsFor(role).includes('record:write');
  return scopes.filter((scope) => scope !== GRAVITY_WRITE_SCOPE || writes);
}

export function canAssignRole(principal: Principal, role: OrgRole): boolean {
  return can(principal, 'member:invite') && ORG_ROLE_RANK[role] <= ORG_ROLE_RANK[principal.role];
}

export function assertVerifiedEmailForInvitation(emailVerified: boolean): void {
  if (!emailVerified) {
    throw forbidden(
      'Verify your email before joining a workspace. Sign in with an emailed code, then accept the invitation again.',
    );
  }
}
