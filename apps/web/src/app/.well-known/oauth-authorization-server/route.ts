import { mcpAuthorizationServerMetadata } from '@/lib/auth/mcp-oauth.ts';
import { METADATA_CORS_HEADERS, metadataPreflight } from '../metadata-headers.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(mcpAuthorizationServerMetadata(), { headers: METADATA_CORS_HEADERS });
}

export function OPTIONS(): Response {
  return metadataPreflight();
}
