import { ORG_ROLE_RANK, ORG_ROLES, type OrgRole } from '@gravity/shared/constants';
import { type Permission, permissionsFor } from '@gravity/shared/policy';

export function minimumRoleFor(permission: Permission): OrgRole {
  const byRank = [...ORG_ROLES].sort((a, b) => ORG_ROLE_RANK[a] - ORG_ROLE_RANK[b]);
  return byRank.find((role) => permissionsFor(role).includes(permission)) ?? 'admin';
}
