import { requireMcpAuth } from "@better-auth/mcp";
import { resourceUrl } from "@crm/auth/options";
import { getAuth } from "@crm/auth/server";
import { errorResponse, limitedBody } from "@crm/core/http";
import { getDatabase } from "@crm/database/client";
import {
  mcpChallengeScopes,
  mcpHandler,
  mcpRequiredScopes,
  principalForVerifiedToken,
} from "@crm/mcp/server";
import { maxFileSize } from "@crm/storage/files";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    const auth = await getAuth();
    return await requireMcpAuth(
      auth,
      async (request, claims) => {
        const db = await getDatabase();
        const principal = await principalForVerifiedToken(db, claims);
        // Authenticate first, then bound the JSON envelope (including base64 files).
        const body = await limitedBody(
          request,
          Math.ceil(maxFileSize / 3) * 4 + 65536,
        );
        return mcpHandler(db, principal, principal.organizationId ?? "").fetch(
          new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: Buffer.from(body),
          }),
        );
      },
      {
        resource: resourceUrl(),
        requiredScopes: mcpRequiredScopes,
        challengeScopes: mcpChallengeScopes,
      },
    )(request);
  } catch (error) {
    return errorResponse(error);
  }
}
