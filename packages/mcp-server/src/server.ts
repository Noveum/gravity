import { verifyMcpAccessToken } from '@gravity/core';
import { GRAVITY_READ_SCOPE, grantsReads, grantsWrites } from '@gravity/shared/constants';
import { forbidden, toDomainError, unauthorized } from '@gravity/shared/errors';
import type { Principal } from '@gravity/shared/policy';
import { recordLinks } from '@gravity/shared/utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { errorFields, logger } from './logger.ts';
import { registerTools } from './tools/index.ts';
import { allowTools, answerWithoutTools } from './tools/support.ts';

export const MCP_PATH = '/mcp';

const SERVER_VERSION = '0.0.0';
const JSONRPC_SERVER_ERROR = -32000;
const INSUFFICIENT_SCOPE_REASON = 'insufficient_scope';
const NO_SCOPE_MESSAGE =
  'This connection holds neither the gravity.read nor the gravity.write scope. Reconnect and grant at least one.';
const INSUFFICIENT_SCOPE_CHALLENGE = `Bearer error="${INSUFFICIENT_SCOPE_REASON}", scope="${GRAVITY_READ_SCOPE}"`;

const INSTRUCTIONS = [
  'Gravity is an outreach CRM. A person exists once; each pursuit of that person in a pipeline is a lead with an identifier such as ABC-12.',
  'Call describe_workspace first to learn the brands, pipelines, stages, custom fields, members and saved views.',
  'Use search to find people, companies and leads, get_context for a compact history of one record, and list_leads to page through a pipeline with the same filters the web app uses.',
  'Every tool acts as the person who connected this client, inside the one workspace they chose when connecting. Each answer links to the record in the web app.',
].join(' ');

export function wwwAuthenticate(publicUrl: string): string {
  const base = publicUrl.replace(/\/+$/, '');
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`;
}

export interface McpServerOptions {
  readonly publicUrl: string;
}

export function createGravityMcpServer(
  principal: Principal,
  scopes: string,
  options: McpServerOptions,
): McpServer {
  const server = new McpServer(
    { name: 'gravity', version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  allowTools(server, { reads: grantsReads(scopes), writes: grantsWrites(scopes) });
  registerTools(server, { principal, links: recordLinks(options.publicUrl) });
  answerWithoutTools(server);
  return server;
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw unauthorized('Connect this client to Gravity to use its tools.');
  }
  return header.slice('bearer '.length).trim();
}

function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: JSONRPC_SERVER_ERROR, message }, id: null },
    { status, headers },
  );
}

async function dispatch(request: Request, options: McpServerOptions): Promise<Response> {
  const identity = await verifyMcpAccessToken(bearerToken(request));
  if (!(grantsReads(identity.scopes) || grantsWrites(identity.scopes))) {
    throw forbidden(NO_SCOPE_MESSAGE, { details: { reason: INSUFFICIENT_SCOPE_REASON } });
  }
  const server = createGravityMcpServer(identity.principal, identity.scopes, options);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport as unknown as Transport);
  try {
    const response = await transport.handleRequest(request);
    logger.info('mcp request', {
      userId: identity.userId,
      organizationId: identity.organizationId,
      clientId: identity.clientId,
    });
    return response;
  } finally {
    await transport.close().catch((error: unknown) => {
      logger.error('transport close failed', errorFields(error));
    });
    await server.close().catch((error: unknown) => {
      logger.error('server close failed', errorFields(error));
    });
  }
}

function refusal(error: unknown, options: McpServerOptions): Response {
  const domain = toDomainError(error);
  const fields = { code: domain.code, ...errorFields(error) };
  if (domain.status >= 500) logger.error('request failed', fields);
  else logger.warn('request refused', fields);
  const message = domain.status >= 500 ? 'Something went wrong on our side.' : domain.message;
  if (domain.status === 401) {
    return rpcError(401, message, { 'WWW-Authenticate': wwwAuthenticate(options.publicUrl) });
  }
  if (domain.status === 403 && domain.details?.['reason'] === INSUFFICIENT_SCOPE_REASON) {
    return rpcError(403, message, { 'WWW-Authenticate': INSUFFICIENT_SCOPE_CHALLENGE });
  }
  return rpcError(domain.status, message);
}

export async function handleMcpRequest(
  request: Request,
  options: McpServerOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    return rpcError(405, 'This endpoint only accepts POST.', { allow: 'POST' });
  }
  try {
    return await dispatch(request, options);
  } catch (error: unknown) {
    return refusal(error, options);
  }
}
