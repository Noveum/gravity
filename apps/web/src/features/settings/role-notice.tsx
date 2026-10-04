import type { Permission } from '@gravity/shared/policy';
import { minimumRoleFor } from '@/features/workspace/role-hint.ts';

export function RoleNotice({
  what,
  permission,
}: {
  readonly what: string;
  readonly permission: Permission;
}) {
  return (
    <p className="text-muted text-dense">
      Changing {what} needs the {minimumRoleFor(permission)} role. Ask an admin.
    </p>
  );
}
