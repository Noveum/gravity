import { resendInvite, revokeInvite } from '@gravity/core';
import { assertCan } from '@gravity/shared/policy';
import { apiContext, handleRoute, publish } from '@/lib/api/handler.ts';
import { inviteView, revealToken } from '@/lib/api/invite-view.ts';
import { sendInviteEmail, shouldSendInvites } from '@/lib/api/send-invite.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const { id } = await params;
    const revoked = await revokeInvite(principal, id);
    await publish(revoked.actions);
    return { invitation: inviteView(revoked.invitation) };
  });
}

export async function PATCH(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const context = await apiContext();
    assertCan(context.principal, 'member:invite');
    const send = shouldSendInvites();
    const { id } = await params;
    const resent = await resendInvite(context.principal, id);
    await publish(resent.actions);
    if (send) {
      await sendInviteEmail({
        invitation: resent.invitation,
        token: resent.token,
        workspaceName: context.organizationName,
        inviterName: context.userName,
      });
    }
    return { invitation: inviteView(resent.invitation), ...revealToken(resent.token) };
  });
}
