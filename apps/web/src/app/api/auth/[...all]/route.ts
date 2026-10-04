import { toNextJsHandler } from 'better-auth/next-js';
import {
  handleMcpTokenRequest,
  MCP_REGISTER_PATH,
  MCP_TOKEN_PATH,
  refuseUnsafeAuthorize,
  refuseUnsafeRegistration,
} from '@/lib/auth/mcp-oauth.ts';
import { auth } from '@/lib/auth/server.ts';
import { withSocketRevocation } from '@/lib/auth/sign-out.ts';

const handlers = toNextJsHandler(auth.handler);

export function GET(request: Request): Promise<Response> | Response {
  return refuseUnsafeAuthorize(request) ?? handlers.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === MCP_TOKEN_PATH) return await handleMcpTokenRequest(request, handlers.POST);
  if (path === MCP_REGISTER_PATH) {
    const refused = await refuseUnsafeRegistration(request);
    if (refused !== null) return refused;
  }
  return await withSocketRevocation(request, handlers.POST);
}
