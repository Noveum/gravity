import { bootstrapPayload, bootstrapVersion } from '@/lib/api/bootstrap.ts';
import { apiContext, cachedJson, handleRoute } from '@/lib/api/handler.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const context = await apiContext({ allowDeleting: true });
    return await cachedJson(request, await bootstrapVersion(context), () =>
      bootstrapPayload(context),
    );
  });
}
