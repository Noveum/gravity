import { startMcpAuthorization } from '@/lib/auth/mcp-oauth.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return startMcpAuthorization(request);
}
