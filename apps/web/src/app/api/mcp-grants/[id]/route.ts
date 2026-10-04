import { revokeMcpGrant } from '@gravity/core';
import { apiContext, handleRoute, routeId } from '@/lib/api/handler.ts';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  { params }: { readonly params: Promise<{ id: string }> },
): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext({ allowDeleting: true });
    await revokeMcpGrant(routeId((await params).id, 'connection'), principal.userId);
    return { ok: true };
  });
}
