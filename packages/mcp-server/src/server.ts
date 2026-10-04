import { consumeRequestRateLimit, verifyMcpAccessToken } from '@gravity/core';
import {
  GRAVITY_READ_SCOPE,
  GRAVITY_WRITE_SCOPE,
  grantsReads,
  grantsWrites,
} from '@gravity/shared/constants';
import { forbidden, toDomainError, unauthorized } from '@gravity/shared/errors';
import type { Principal } from '@gravity/shared/policy';
import { readCappedBytes, recordLinks } from '@gravity/shared/utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { errorFields, logger } from './logger.ts';
import { registerTools } from './tools/index.ts';
import { allowTools, answerWithoutTools } from './tools/support.ts';

export const MCP_PATH = '/mcp';
export const MCP_BODY_LIMIT_BYTES = 1_000_000;
export const MCP_GRANT_RATE = { window: 60, max: 300 } as const;

const SERVER_VERSION = '0.0.0';
const JSONRPC_SERVER_ERROR = -32000;
const INSUFFICIENT_SCOPE_REASON = 'insufficient_scope';
const NO_SCOPE_MESSAGE =
  'This connection holds neither the gravity.read nor the gravity.write scope. Reconnect and grant at least one.';
const INVALID_TOKEN_REASON = 'invalid_token';
const NO_TOKEN_MESSAGE = 'Connect this client to Gravity to use its tools.';
const BEARER_PREFIX = 'bearer ';
const BODY_TOO_LARGE_MESSAGE = 'The request body is larger than 1 MB.';
const RATE_LIMITED_MESSAGE = 'This connection has sent too many requests. Try again in a minute.';
const CHALLENGE_SCOPES = `${GRAVITY_READ_SCOPE} ${GRAVITY_WRITE_SCOPE}`;

const INSTRUCTIONS = [
  'Gravity is an outreach CRM. A person exists once; each pursuit of that person in a pipeline is a lead with an identifier such as ABC-12.',
  'Call describe_workspace first to learn the brands, pipelines, stages, custom fields, members and saved views.',
  'Use search to find people, companies and leads, get_context for a compact history of one record, and list_leads to page through a pipeline with the same filters the web app uses.',
  'Every tool acts as the person who connected this client, inside the one workspace they chose when connecting. Each answer links to the record in the web app.',
].join(' ');

export function wwwAuthenticate(
  publicUrl: string,
  parameters: Readonly<Record<string, string>> = {},
): string {
  const base = publicUrl.replace(/\/+$/, '');
  const metadata = `${base}/.well-known/oauth-protected-resource/mcp`;
  const pairs = Object.entries({ ...parameters, resource_metadata: metadata });
  return `Bearer ${pairs.map(([name, value]) => `${name}="${value}"`).join(', ')}`;
}

export interface McpServerOptions {
  readonly publicUrl: string;
  readonly grantRate?: { readonly window: number; readonly max: number };
}

export function createGravityMcpServer(
  principal: Principal,
  scopes: string,
  options: McpServerOptions & { readonly workspaceSlug: string },
): McpServer {
  const server = new McpServer(
    { name: 'gravity', version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  allowTools(server, { reads: grantsReads(scopes), writes: grantsWrites(scopes) });
  registerTools(server, {
    principal,
    links: recordLinks(options.publicUrl, options.workspaceSlug),
  });
  answerWithoutTools(server);
  return server;
}

function presentedToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length === 0 ? null : token;
}

function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code: JSONRPC_SERVER_ERROR, message }, id: null },
    { status, headers },
  );
}

async function dispatch(
  request: Request,
  token: string | null,
  options: McpServerOptions,
): Promise<Response> {
  if (token === null) throw unauthorized(NO_TOKEN_MESSAGE);
  const identity = await verifyMcpAccessToken(token);
  if (!(grantsReads(identity.scopes) || grantsWrites(identity.scopes))) {
    throw forbidden(NO_SCOPE_MESSAGE, { details: { reason: INSUFFICIENT_SCOPE_REASON } });
  }
  const body = await readCappedBytes(request, MCP_BODY_LIMIT_BYTES);
  if (body === null) return rpcError(413, BODY_TOO_LARGE_MESSAGE);
  const rate = options.grantRate ?? MCP_GRANT_RATE;
  const decision = await consumeRequestRateLimit(`mcp:${identity.grantId}`, rate);
  if (!decision.allowed) {
    return rpcError(429, RATE_LIMITED_MESSAGE, {
      'Retry-After': String(decision.retryAfter ?? rate.window),
    });
  }
  const server = createGravityMcpServer(identity.principal, identity.scopes, {
    publicUrl: options.publicUrl,
    workspaceSlug: identity.organizationSlug,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport as unknown as Transport);
  try {
    const response = await transport.handleRequest(
      new Request(request.url, { method: request.method, headers: request.headers, body }),
    );
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

function refusal(error: unknown, presented: boolean, options: McpServerOptions): Response {
  const domain = toDomainError(error);
  const fields = { code: domain.code, ...errorFields(error) };
  if (domain.status >= 500) logger.error('request failed', fields);
  else logger.warn('request refused', fields);
  const message = domain.status >= 500 ? 'Something went wrong on our side.' : domain.message;
  if (domain.status === 401) {
    const challenge = wwwAuthenticate(
      options.publicUrl,
      presented
        ? { error: INVALID_TOKEN_REASON, scope: CHALLENGE_SCOPES }
        : { scope: CHALLENGE_SCOPES },
    );
    return rpcError(401, message, { 'WWW-Authenticate': challenge });
  }
  if (domain.status === 403 && domain.details?.['reason'] === INSUFFICIENT_SCOPE_REASON) {
    const challenge = wwwAuthenticate(options.publicUrl, {
      error: INSUFFICIENT_SCOPE_REASON,
      scope: GRAVITY_READ_SCOPE,
    });
    return rpcError(403, message, { 'WWW-Authenticate': challenge });
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
  const token = presentedToken(request);
  try {
    return await dispatch(request, token, options);
  } catch (error: unknown) {
    return refusal(error, token !== null, options);
  }
}
