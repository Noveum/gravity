import { readOutboxSince } from '@gravity/core';
import { forbidden, unauthorized } from '@gravity/shared/errors';
import { CATCHUP_LIMIT, syncCatchupQuerySchema } from '@gravity/shared/events';
import { handleRoute, searchParamsOf } from '@/lib/api/handler.ts';
import { resolveMembership } from '@/lib/auth/principal.ts';
import { getSession } from '@/lib/auth/session.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    const { organizationId, since } = syncCatchupQuerySchema.parse(searchParamsOf(request));
    const membership = await resolveMembership(session.user.id, organizationId);
    if (membership === null || membership.principal.organizationId !== organizationId) {
      throw forbidden('You are not a member of this workspace.');
    }
    return await readOutboxSince({ organizationId, userId: session.user.id }, since, CATCHUP_LIMIT);
  });
}
