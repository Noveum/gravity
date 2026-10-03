import { listMembers, listPendingInvites } from '@gravity/core';
import { can, canAssignRole, policyRole } from '@gravity/shared/policy';
import { emailConfigured } from '@gravity/shared/utils';
import type { Metadata } from 'next';
import { MembersPanel } from '@/features/settings/members-panel.tsx';
import { devLoginEnabled } from '@/lib/api/dev-login.ts';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Members' };

export default async function MembersSettingsPage() {
  const { principal } = await pageContext({ allowDeleting: true });
  const canInvite = can(principal, 'member:invite');
  const [members, invites] = await Promise.all([
    listMembers(principal),
    canInvite ? listPendingInvites(principal) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <MembersPanel
        currentUserId={principal.userId}
        members={members.map((entry) => ({
          memberId: entry.member.id,
          userId: entry.user.id,
          name: entry.user.name,
          email: entry.user.email,
          image: entry.user.image,
          role: policyRole(entry.member.role),
        }))}
        invites={invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: policyRole(invite.role),
        }))}
        canInvite={canInvite}
        canInviteAdmins={canAssignRole(principal, 'admin')}
        canManage={can(principal, 'member:manage')}
        canDeliverInvites={emailConfigured(process.env) || devLoginEnabled()}
      />
    </div>
  );
}
