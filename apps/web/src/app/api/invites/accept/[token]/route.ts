import { acceptInvite } from '@gravity/core';
import { unauthorized } from '@gravity/shared/errors';
import { headers } from 'next/headers';
import { handleRoute, publish } from '@/lib/api/handler.ts';
import { auth } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';

interface RouteParams {
  readonly params: Promise<{ token: string }>;
}

export async function POST(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized('Sign in to accept this invite.');
    const { token } = await params;
    const accepted = await acceptInvite(token, session.user.id);
    await publish(accepted.actions);
    await auth.api.setActiveOrganization({
      headers: await headers(),
      body: { organizationId: accepted.organizationId },
    });
    return {
      organizationId: accepted.organizationId,
      alreadyAccepted: accepted.alreadyAccepted,
    };
  });
}
