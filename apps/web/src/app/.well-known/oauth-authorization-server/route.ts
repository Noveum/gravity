import { MCP_OAUTH_SCOPES } from '@gravity/shared/constants';
import { auth, MCP_AUTHORIZE_START_PATH } from '@/lib/auth/server.ts';
import { absoluteUrl } from '@/lib/env.ts';
import { METADATA_CORS_HEADERS, metadataPreflight } from '../metadata-headers.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const metadata = await auth.api.getMcpOAuthConfig({ headers: request.headers });
  return Response.json(
    {
      ...metadata,
      authorization_endpoint: absoluteUrl(MCP_AUTHORIZE_START_PATH),
      scopes_supported: [...MCP_OAUTH_SCOPES],
    },
    { headers: METADATA_CORS_HEADERS },
  );
}

export function OPTIONS(): Response {
  return metadataPreflight();
}
