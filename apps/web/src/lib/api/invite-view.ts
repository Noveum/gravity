import type { InvitationRow } from '@gravity/core';
import { devLoginEnabled } from '@/lib/api/dev-login.ts';

export function inviteView(invitation: InvitationRow) {
  return {
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
  };
}

export function pendingInviteView(invitation: InvitationRow) {
  return { id: invitation.id, ...inviteView(invitation) };
}

export function revealToken(token: string): { readonly token?: string } {
  return devLoginEnabled() ? { token } : {};
}
