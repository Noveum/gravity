import type { InvitationRow } from '@gravity/core';
import { db } from '@gravity/db';
import { assertEmailConfigured, inviteEmail, sendEmail } from '@gravity/services/email';
import { emailConfigured } from '@gravity/shared/utils';
import { devLoginEnabled } from '@/lib/api/dev-login.ts';
import { serverEnv } from '@/lib/env.ts';

export function shouldSendInvites(): boolean {
  if (emailConfigured(process.env)) return true;
  if (!devLoginEnabled()) assertEmailConfigured();
  return false;
}

export function inviteAcceptUrl(token: string): string {
  return `${serverEnv().NEXT_PUBLIC_APP_URL}/invite/${token}`;
}

export async function sendInviteEmail(params: {
  readonly invitation: InvitationRow;
  readonly token: string;
  readonly workspaceName: string;
  readonly inviterName: string;
}): Promise<void> {
  const content = await inviteEmail({
    workspaceName: params.workspaceName,
    inviterName: params.inviterName,
    url: inviteAcceptUrl(params.token),
  });
  await sendEmail(db, {
    to: params.invitation.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    template: 'invite',
    idempotencyKey: `invite:${params.invitation.id}:${params.invitation.expiresAt.toISOString()}`,
  });
}
