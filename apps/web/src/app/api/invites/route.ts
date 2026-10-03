import { createInvite, createInvites, listPendingInvites } from '@gravity/core';
import { assertCan } from '@gravity/shared/policy';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';
import { inviteView, revealToken } from '@/lib/api/invite-view.ts';
import { sendInviteEmail, shouldSendInvites } from '@/lib/api/send-invite.ts';

export async function GET(_request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const pending = await listPendingInvites(principal);
    return { invites: pending.map(inviteView) };
  });
}

function isBulk(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'invites' in body;
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const context = await apiContext();
    assertCan(context.principal, 'member:invite');
    const send = shouldSendInvites();
    const body = await readJson(request);
    const delivery = { workspaceName: context.organizationName, inviterName: context.userName };

    if (isBulk(body)) {
      const created = await createInvites(context.principal, body);
      await publish(created.actions);
      if (send) {
        for (const entry of created.invites) {
          await sendInviteEmail({ invitation: entry.invitation, token: entry.token, ...delivery });
        }
      }
      return {
        invites: created.invites.map((entry) => ({
          invitation: inviteView(entry.invitation),
          ...revealToken(entry.token),
        })),
      };
    }

    const created = await createInvite(context.principal, body);
    await publish(created.actions);
    if (send) {
      await sendInviteEmail({ invitation: created.invitation, token: created.token, ...delivery });
    }
    return { invitation: inviteView(created.invitation), ...revealToken(created.token) };
  });
}
