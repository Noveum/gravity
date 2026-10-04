import { listMcpGrants } from '@gravity/core';
import { scopeList } from '@gravity/shared/constants';
import { apiContext, handleRoute } from '@/lib/api/handler.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext({ allowDeleting: true });
    const grants = await listMcpGrants(principal.userId);
    return {
      connections: grants.map((grant) => ({
        id: grant.id,
        clientName: grant.clientName,
        clientLogo: grant.clientLogo,
        redirectHosts: grant.redirectHosts,
        organizationName: grant.organizationName,
        scopes: scopeList(grant.scopes),
        createdAt: grant.createdAt.toISOString(),
        lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
      })),
    };
  });
}
