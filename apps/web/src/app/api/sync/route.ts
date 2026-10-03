import { readOutboxSince } from '@gravity/core';
import { CATCHUP_LIMIT, syncCatchupQuerySchema } from '@gravity/shared/events';
import { apiContext, handleRoute, searchParamsOf } from '@/lib/api/handler.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const context = await apiContext();
    const { since } = syncCatchupQuerySchema.parse(searchParamsOf(request));
    return await readOutboxSince(context.principal.organizationId, since, CATCHUP_LIMIT);
  });
}
