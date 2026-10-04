import { ORG_ROLE_RANK, ORG_ROLES, type OrgRole } from '@gravity/shared/constants';
import { PERMISSIONS, type Permission, permissionsFor } from '@gravity/shared/policy';
import { ApiError, messageOf } from '@/lib/query/fetcher.ts';

export function minimumRoleFor(permission: Permission): OrgRole {
  const byRank = [...ORG_ROLES].sort((a, b) => ORG_ROLE_RANK[a] - ORG_ROLE_RANK[b]);
  return byRank.find((role) => permissionsFor(role).includes(permission)) ?? 'admin';
}

export function permissionOf(error: unknown): Permission | null {
  if (!(error instanceof ApiError) || error.code !== 'forbidden') return null;
  const permission = error.details?.['permission'];
  return PERMISSIONS.find((entry) => entry === permission) ?? null;
}

export function describeFailure(error: unknown, fallback?: string): string {
  const permission = permissionOf(error);
  if (permission === null) return messageOf(error, fallback);
  return `${messageOf(error)} Ask an admin for the ${minimumRoleFor(permission)} role.`;
}
