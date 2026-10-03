import { requireMcpAuth } from "@better-auth/mcp";
import { resourceUrl } from "@crm/auth/options";
import { getAuth } from "@crm/auth/server";
import { errorResponse } from "@crm/core/http";
import { getDatabase } from "@crm/database/client";
import { mcpHandler, principalForVerifiedToken } from "@crm/mcp/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const auth = await getAuth();
    return await requireMcpAuth(
      auth,
      async (request, claims) => {
        const db = await getDatabase();
        const principal = await principalForVerifiedToken(db, claims);
        return mcpHandler(db, principal, principal.organizationId ?? "").fetch(
          request,
        );
      },
      { resource: resourceUrl(), requiredScopes: ["crm:read"] },
    )(request);
  } catch (error) {
    return errorResponse(error);
  }
}
