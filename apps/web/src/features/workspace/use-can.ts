'use client';

import { can, type Permission } from '@gravity/shared/policy';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';

export function useCan(permission: Permission): boolean {
  const { data } = useBootstrap();
  if (data === undefined) return false;
  return can(
    { userId: data.me.userId, organizationId: data.organization.id, role: data.me.role },
    permission,
  );
}
