import { bindMcpCredential, cappedTransaction, unbindMcpCredential } from '@gravity/core';
import { and, db, eq, isNull, schema } from '@gravity/db';
import { isAllowedRedirectUri } from '@gravity/shared/utils';
import { z } from 'zod';
import { auth, MCP_TOKEN_RATE_LIMIT_PROBE_HEADER } from '@/lib/auth/server.ts';
import { mcpServerUrl, serverEnv } from '@/lib/env.ts';

export const MCP_AUTHORIZE_PATH = '/api/auth/mcp/authorize';
export const MCP_TOKEN_PATH = '/api/auth/mcp/token';
export const MCP_REGISTER_PATH = '/api/auth/mcp/register';

type AuthHandler = (request: Request) => Promise<Response>;

type OAuthErrorCode =
  | 'invalid_client_metadata'
  | 'invalid_grant'
  | 'invalid_redirect_uri'
  | 'invalid_request'
  | 'invalid_target'
  | 'server_error'
  | 'unsupported_grant_type';

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' } as const;
const RECONNECT = 'Reconnect Gravity to continue.';
const codeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const codeVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);

function oauthError(error: OAuthErrorCode, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status, headers: NO_STORE });
}

function sameResource(values: readonly string[]): boolean {
  const expected = mcpServerUrl().replace(/\/+$/, '');
  return values.every((value) => value.replace(/\/+$/, '') === expected);
}

function targetRefusal(): Response {
  return oauthError('invalid_target', `This server only issues tokens for ${mcpServerUrl()}.`);
}

export function refuseUnsafeAuthorize(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== MCP_AUTHORIZE_PATH) return null;
  const prompts = url.searchParams.getAll('prompt');
  if (prompts.length !== 1 || prompts[0] !== 'consent') {
    return oauthError('invalid_request', 'Explicit consent is required.');
  }
  const challenges = url.searchParams.getAll('code_challenge');
  if (
    challenges.length > 0 &&
    (challenges.length !== 1 || !codeChallengeSchema.safeParse(challenges[0]).success)
  ) {
    return oauthError('invalid_request', 'The PKCE code challenge is invalid.');
  }
  if (!sameResource(url.searchParams.getAll('resource'))) return targetRefusal();
  return null;
}

const registrationSchema = z.looseObject({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(5),
  client_name: z
    .string({ error: 'A client_name of up to 100 characters is required.' })
    .max(100)
    .trim()
    .min(1),
});

export async function refuseUnsafeRegistration(request: Request): Promise<Response | null> {
  let body: unknown;
  try {
    body = JSON.parse(await request.clone().text()) as unknown;
  } catch {
    return oauthError('invalid_client_metadata', 'The registration body is not valid JSON.');
  }
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return oauthError(
      'invalid_client_metadata',
      parsed.error.issues[0]?.message ?? 'The client metadata is invalid.',
    );
  }
  const refused = parsed.data.redirect_uris.find(
    (uri) => uri !== uri.trim() || !isAllowedRedirectUri(uri),
  );
  if (refused === undefined) return null;
  return oauthError(
    'invalid_redirect_uri',
    `${refused} is not an allowed redirect URI. Use https, a loopback http address, or an app scheme.`,
  );
}

const tokenRequestSchema = z
  .object({
    grant_type: z.string().min(1),
    code: z.string().min(1).optional(),
    code_verifier: z.string().optional(),
    refresh_token: z.string().min(1).optional(),
    resource: z.string().optional(),
  })
  .catchall(z.string());

type TokenRequest = z.infer<typeof tokenRequestSchema>;

const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
});

const authorizationCodeSchema = z.object({ mcpGrantId: z.string().min(1) });

async function parsedTokenRequest(request: Request): Promise<TokenRequest | null> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  let raw: unknown;
  if (mediaType === 'application/x-www-form-urlencoded') {
    const search = new URLSearchParams(await request.clone().text());
    for (const key of new Set(search.keys())) {
      if (search.getAll(key).length !== 1) return null;
    }
    raw = Object.fromEntries(search);
  } else if (mediaType === 'application/json') {
    try {
      raw = JSON.parse(await request.clone().text()) as unknown;
    } catch {
      return null;
    }
  } else {
    return null;
  }
  const parsed = tokenRequestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function rateLimited(request: Request, post: AuthHandler): Promise<Response | null> {
  const headers = new Headers(request.headers);
  headers.set(MCP_TOKEN_RATE_LIMIT_PROBE_HEADER, '1');
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  const response = await post(new Request(request.url, { method: 'POST', headers, body: '{}' }));
  return response.status === 204 ? null : response;
}

function issueToken(request: Request, body: Record<string, unknown>): Promise<Response> {
  return auth.api.mcpOAuthToken({ request, headers: request.headers, body, asResponse: true });
}

async function activeGrant(grantId: string): Promise<boolean> {
  const [grant] = await db
    .select({ id: schema.mcpGrant.id })
    .from(schema.mcpGrant)
    .where(and(eq(schema.mcpGrant.id, grantId), isNull(schema.mcpGrant.revokedAt)))
    .limit(1);
  return grant !== undefined;
}

async function grantOfCode(code: string): Promise<string | null> {
  const [record] = await db
    .select({ value: schema.verification.value })
    .from(schema.verification)
    .where(eq(schema.verification.identifier, code))
    .limit(1);
  if (record === undefined) return null;
  try {
    const parsed = authorizationCodeSchema.safeParse(JSON.parse(record.value));
    return parsed.success ? parsed.data.mcpGrantId : null;
  } catch {
    return null;
  }
}

async function acceptIssuedToken(
  grantId: string,
  accessToken: string,
  sourceRefreshToken: string | null,
): Promise<boolean> {
  if (sourceRefreshToken === null) {
    if (await activeGrant(grantId)) return true;
    await db
      .delete(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, accessToken));
    return false;
  }
  return await cappedTransaction(async (tx) => {
    const [consumed] = await tx
      .delete(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.refreshToken, sourceRefreshToken))
      .returning({ id: schema.oauthAccessToken.id });
    if (consumed !== undefined) {
      const [grant] = await tx
        .select({ id: schema.mcpGrant.id })
        .from(schema.mcpGrant)
        .where(and(eq(schema.mcpGrant.id, grantId), isNull(schema.mcpGrant.revokedAt)))
        .limit(1);
      if (grant !== undefined) return true;
    }
    await tx
      .delete(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.accessToken, accessToken));
    return false;
  });
}

async function securedTokenResponse(
  response: Response,
  grantId: string,
  sourceRefreshToken: string | null,
): Promise<Response> {
  if (!response.ok) return response;
  let raw: unknown;
  try {
    raw = (await response.clone().json()) as unknown;
  } catch {
    return oauthError('server_error', 'The token response could not be secured.', 500);
  }
  const token = tokenResponseSchema.safeParse(raw);
  if (!token.success) {
    return oauthError('server_error', 'The token response could not be secured.', 500);
  }
  if (!(await acceptIssuedToken(grantId, token.data.access_token, sourceRefreshToken))) {
    return oauthError('invalid_grant', RECONNECT);
  }
  const secret = serverEnv().BETTER_AUTH_SECRET;
  const secured = {
    ...token.data,
    access_token: bindMcpCredential(token.data.access_token, grantId, secret),
    ...(token.data.refresh_token === undefined
      ? {}
      : { refresh_token: bindMcpCredential(token.data.refresh_token, grantId, secret) }),
  };
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  headers.set('pragma', 'no-cache');
  return new Response(JSON.stringify(secured), { status: response.status, headers });
}

export async function handleMcpTokenRequest(
  request: Request,
  post: AuthHandler,
): Promise<Response> {
  const limited = await rateLimited(request, post);
  if (limited !== null) return limited;
  const body = await parsedTokenRequest(request);
  if (body === null) return oauthError('invalid_request', 'The token request is invalid.');
  if (body.grant_type !== 'authorization_code' && body.grant_type !== 'refresh_token') {
    return oauthError('unsupported_grant_type', 'The requested grant type is not supported.');
  }
  if (body.resource !== undefined && !sameResource([body.resource])) return targetRefusal();
  if (body.grant_type === 'authorization_code') {
    if (body.code === undefined) {
      return oauthError('invalid_request', 'An authorization code is required.');
    }
    if (!codeVerifierSchema.safeParse(body.code_verifier).success) {
      return oauthError('invalid_request', 'The PKCE code verifier is invalid.');
    }
    const grantId = await grantOfCode(body.code);
    if (grantId === null || !(await activeGrant(grantId))) {
      return oauthError('invalid_grant', RECONNECT);
    }
    return securedTokenResponse(await issueToken(request, body), grantId, null);
  }
  if (body.refresh_token === undefined) {
    return oauthError('invalid_request', 'A refresh token is required.');
  }
  const binding = unbindMcpCredential(body.refresh_token, serverEnv().BETTER_AUTH_SECRET);
  if (binding === null || !(await activeGrant(binding.grantId))) {
    return oauthError('invalid_grant', RECONNECT);
  }
  const [source] = await db
    .select({ id: schema.oauthAccessToken.id })
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.refreshToken, binding.credential))
    .limit(1);
  if (source === undefined) return oauthError('invalid_grant', RECONNECT);
  return securedTokenResponse(
    await issueToken(request, { ...body, refresh_token: binding.credential }),
    binding.grantId,
    binding.credential,
  );
}
