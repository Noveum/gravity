import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import {
  createOrganization,
  finalizeMcpConsent,
  newId,
  recordMcpGrant,
  unbindMcpCredential,
  verifyMcpAccessToken,
} from '@gravity/core';
import {
  createWorkspace,
  insertMcpClient,
  insertMcpConsentRequest,
  MCP_TEST_CODE_VERIFIER,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { db, eq, schema } from '@gravity/db';
import { POST as authPost, GET } from '@/app/api/auth/[...all]/route.ts';
import { auth } from '@/lib/auth/server.ts';
import { mcpServerUrl } from '@/lib/env.ts';
import { withNativeFetch } from '../../../../support/native-fetch.ts';

const APP_ORIGIN = 'http://localhost:3300';
const CLIENT_ID = 'client_test';
const CALLBACK_URL = 'http://127.0.0.1:9000/callback';
const CHALLENGE = createHash('sha256').update(MCP_TEST_CODE_VERIFIER).digest('base64url');

async function signedSessionCookie(token: string): Promise<string> {
  const context = await auth.$context;
  const signature = createHmac('sha256', context.secret).update(token).digest('base64');
  return `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`;
}

function authorizeSearch(extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    scope: 'openid offline_access gravity.read',
    state: 'state_test',
    ...extra,
  });
}

function authorizeRequest(
  search: URLSearchParams,
  cookie?: string,
  path = '/api/auth/mcp/authorize',
): Request {
  const request = new Request(`${APP_ORIGIN}${path}?${search.toString()}`);
  if (cookie !== undefined) request.headers.set('cookie', cookie);
  return request;
}

function tokenRequest(body: Record<string, string>, form = true): Request {
  return new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
    method: 'POST',
    headers: {
      'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
    },
    body: form ? new URLSearchParams(body) : JSON.stringify(body),
  });
}

function registerRequest(body: unknown, ip = '198.51.100.7'): Request {
  return new Request(`${APP_ORIGIN}/api/auth/mcp/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

let workspace: TestWorkspace;
let cookie = '';

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Oauth');
  await insertMcpClient(workspace.adminUser.id, {
    clientId: CLIENT_ID,
    name: 'Test MCP client',
    redirectUrl: CALLBACK_URL,
  });
  const token = `session_${newId()}`;
  await db.insert(schema.session).values({
    id: newId(),
    token,
    userId: workspace.adminUser.id,
    activeOrganizationId: workspace.organizationId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  cookie = await signedSessionCookie(token);
});

async function authorizationCode(): Promise<string> {
  const consentCode = await insertMcpConsentRequest({
    clientId: CLIENT_ID,
    userId: workspace.adminUser.id,
    scope: ['openid', 'offline_access', 'gravity.read'],
    redirectUri: CALLBACK_URL,
    state: 'state_test',
  });
  const approved = await finalizeMcpConsent({
    userId: workspace.adminUser.id,
    consentCode,
    accept: true,
    organizationId: workspace.organizationId,
    allowApproval: false,
  });
  const code = new URL(approved.redirectUri).searchParams.get('code');
  if (code === null) throw new Error('the consent redirect carried no code');
  return code;
}

function afterTokenIssue(after: () => Promise<void>) {
  const original = auth.api.mcpOAuthToken;
  const issueThen = Object.assign(async (...args: Parameters<typeof original>) => {
    const response = await original(...args);
    await after();
    return response;
  }, original);
  return spyOn(auth.api, 'mcpOAuthToken').mockImplementation(issueThen);
}

function exchange(code: string): Request {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    code_verifier: MCP_TEST_CODE_VERIFIER,
  });
}

describe('authorize', () => {
  test('refuses a request without exactly one prompt=consent', async () => {
    expect((await GET(authorizeRequest(authorizeSearch()))).status).toBe(400);
    const doubled = authorizeSearch({ prompt: 'consent' });
    doubled.append('prompt', 'consent');
    expect((await GET(authorizeRequest(doubled))).status).toBe(400);
  });

  test('refuses a code challenge that is not an S256 digest', async () => {
    const search = authorizeSearch({
      prompt: 'consent',
      code_challenge: 'A'.repeat(42),
      code_challenge_method: 'S256',
    });
    expect((await GET(authorizeRequest(search, cookie))).status).toBe(400);
  });

  test('refuses another resource with invalid_target', async () => {
    const search = authorizeSearch({
      prompt: 'consent',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      resource: 'https://elsewhere.example.com/mcp',
    });
    const response = await GET(authorizeRequest(search, cookie));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_target' });
  });

  test('a signed in user continues to the consent page', async () => {
    const search = authorizeSearch({
      prompt: 'consent',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      resource: mcpServerUrl(),
    });
    const response = await GET(authorizeRequest(search, cookie));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '', APP_ORIGIN);
    expect(location.pathname).toBe('/oauth/authorize');
    expect(location.searchParams.get('consent_code')).not.toBeNull();
  });

  test('alternate authorize paths never skip the consent checks', async () => {
    const search = authorizeSearch({ code_challenge: CHALLENGE, code_challenge_method: 'S256' });
    for (const path of [
      '/api/auth/mcp/authorize/',
      '/api/auth/mcp/AUTHORIZE',
      '/api/auth/mcp/%61uthorize',
    ]) {
      const response = await GET(authorizeRequest(search, cookie, path));
      expect(response.status).toBe(404);
    }
    expect(await db.select().from(schema.verification)).toHaveLength(0);
  });
});

describe('dynamic client registration', () => {
  test('refuses unsafe redirect URIs and long names', async () => {
    await withNativeFetch(async () => {
      const javascript = await authPost(
        registerRequest({ client_name: 'Desk agent', redirect_uris: ['javascript:alert(1)'] }),
      );
      expect(javascript.status).toBe(400);
      expect(await javascript.json()).toMatchObject({ error: 'invalid_redirect_uri' });
      const plainHttp = await authPost(
        registerRequest({
          client_name: 'Desk agent',
          redirect_uris: ['http://agent.example.com/cb'],
        }),
      );
      expect(plainHttp.status).toBe(400);
      const named = await authPost(
        registerRequest({ redirect_uris: [CALLBACK_URL], client_name: 'x'.repeat(101) }),
      );
      expect(await named.json()).toMatchObject({ error: 'invalid_client_metadata' });
      const unnamed = await authPost(registerRequest({ redirect_uris: [CALLBACK_URL] }));
      expect(unnamed.status).toBe(400);
      expect(await unnamed.json()).toMatchObject({ error: 'invalid_client_metadata' });
    });
    expect(await db.select().from(schema.oauthApplication)).toHaveLength(1);
  });

  test('refuses a comma-joined javascript redirect and a data URI', async () => {
    await withNativeFetch(async () => {
      for (const uri of [
        'https://evil.example/cb,javascript:alert(document.cookie)',
        'data:text/html,<script>alert(1)</script>',
        ' JavaScript:alert(1)',
      ]) {
        const response = await authPost(
          registerRequest({ client_name: 'Smuggler', redirect_uris: [uri] }),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'invalid_redirect_uri' });
      }
      const mixed = await authPost(
        registerRequest({
          client_name: 'Smuggler',
          redirect_uris: [CALLBACK_URL, 'https://evil.example/cb,javascript:alert(1)'],
        }),
      );
      expect(mixed.status).toBe(400);
    });
    expect(await db.select().from(schema.oauthApplication)).toHaveLength(1);
  });

  test('accepts https and loopback http redirects', async () => {
    await withNativeFetch(async () => {
      const response = await authPost(
        registerRequest({
          client_name: 'Web agent',
          redirect_uris: ['https://agent.example.com/callback', 'http://localhost:4100/cb'],
          token_endpoint_auth_method: 'none',
        }),
      );
      expect(response.status).toBe(201);
    });
    const stored = await db.select().from(schema.oauthApplication);
    expect(stored.map((row) => row.redirectUrls)).toContain(
      'https://agent.example.com/callback,http://localhost:4100/cb',
    );
  });

  test('registers a loopback client', async () => {
    await withNativeFetch(async () => {
      const response = await authPost(
        registerRequest({
          client_name: 'Desk agent',
          redirect_uris: [CALLBACK_URL],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        }),
      );
      expect(response.ok).toBe(true);
      const clientId = ((await response.json()) as { client_id?: unknown }).client_id;
      expect(clientId).toEqual(expect.any(String));
      const [stored] = await db
        .select()
        .from(schema.oauthApplication)
        .where(eq(schema.oauthApplication.clientId, String(clientId)));
      expect(stored).toMatchObject({
        name: 'Desk agent',
        redirectUrls: CALLBACK_URL,
        type: 'public',
      });
    });
  });

  test('limits registrations per address', async () => {
    await withNativeFetch(async () => {
      const context = await auth.$context;
      const previous = { enabled: context.rateLimit.enabled };
      Object.assign(context.rateLimit, { enabled: true });
      try {
        const body = {
          client_name: 'Burst',
          redirect_uris: [CALLBACK_URL],
          token_endpoint_auth_method: 'none',
        };
        for (let attempt = 0; attempt < 10; attempt += 1) {
          expect((await authPost(registerRequest(body, '203.0.113.9'))).status).not.toBe(429);
        }
        expect((await authPost(registerRequest(body, '203.0.113.9'))).status).toBe(429);
        expect((await authPost(registerRequest(body, '203.0.113.10'))).status).not.toBe(429);
      } finally {
        Object.assign(context.rateLimit, previous);
      }
    });
  });
});

describe('token', () => {
  test('returns OAuth errors for malformed and unsupported grants', async () => {
    const missing = await authPost(tokenRequest({ grant_type: 'authorization_code' }, false));
    expect(await missing.json()).toMatchObject({ error: 'invalid_request' });
    const unsupported = await authPost(tokenRequest({ grant_type: 'client_credentials' }, false));
    expect(await unsupported.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });

  test('refuses a token request for another resource', async () => {
    const response = await authPost(
      tokenRequest({
        grant_type: 'authorization_code',
        code: 'anything',
        code_verifier: MCP_TEST_CODE_VERIFIER,
        resource: 'https://elsewhere.example.com/mcp',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_target' });
  });

  test('rate limits token requests before their database prechecks', async () => {
    await withNativeFetch(async () => {
      const context = await auth.$context;
      const previous = { enabled: context.rateLimit.enabled };
      Object.assign(context.rateLimit, { enabled: true });
      try {
        const attempt = () => {
          const request = tokenRequest({ grant_type: 'authorization_code', code: 'nope' });
          request.headers.set('x-forwarded-for', '203.0.113.20');
          return authPost(request);
        };
        for (let index = 0; index < 30; index += 1) {
          expect((await attempt()).status).not.toBe(429);
        }
        expect((await attempt()).status).toBe(429);
      } finally {
        Object.assign(context.rateLimit, previous);
      }
    });
  });

  test('binds the access and refresh tokens to the consented workspace grant', async () => {
    await withNativeFetch(async () => {
      const response = await authPost(exchange(await authorizationCode()));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = (await response.json()) as Record<string, unknown>;
      const accessToken = String(body['access_token']);
      const refreshToken = String(body['refresh_token']);
      expect(accessToken.startsWith('gravity-mcp-v1.')).toBe(true);
      expect((await verifyMcpAccessToken(accessToken)).organizationId).toBe(
        workspace.organizationId,
      );
      const context = await auth.$context;
      const raw = unbindMcpCredential(refreshToken, context.secret);
      expect(raw).not.toBeNull();
      const rawRefresh = await authPost(
        tokenRequest(
          {
            grant_type: 'refresh_token',
            refresh_token: raw?.credential ?? '',
            client_id: CLIENT_ID,
          },
          false,
        ),
      );
      expect(await rawRefresh.json()).toMatchObject({ error: 'invalid_grant' });
      const refreshed = await authPost(
        tokenRequest(
          { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID },
          false,
        ),
      );
      expect(refreshed.status).toBe(200);
      const renewed = (await refreshed.json()) as Record<string, unknown>;
      expect((await verifyMcpAccessToken(String(renewed['access_token']))).organizationId).toBe(
        workspace.organizationId,
      );
      await expect(verifyMcpAccessToken(accessToken)).rejects.toMatchObject({
        code: 'unauthorized',
      });
      const replayed = await authPost(
        tokenRequest(
          { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID },
          false,
        ),
      );
      expect(await replayed.json()).toMatchObject({ error: 'invalid_grant' });
    });
  });

  test('only one of two concurrent refreshes consumes the refresh token', async () => {
    await withNativeFetch(async () => {
      const issued = (await (await authPost(exchange(await authorizationCode()))).json()) as Record<
        string,
        unknown
      >;
      const refresh = () =>
        authPost(
          tokenRequest(
            {
              grant_type: 'refresh_token',
              refresh_token: String(issued['refresh_token']),
              client_id: CLIENT_ID,
            },
            false,
          ),
        );
      const responses = await Promise.all([refresh(), refresh()]);
      expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
      const refused = responses.find((response) => response.status !== 200);
      expect(await refused?.json()).toMatchObject({ error: 'invalid_grant' });
      expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(1);
    });
  });

  test('a refresh token consumed while a token is being issued keeps no new token', async () => {
    await withNativeFetch(async () => {
      const issued = (await (await authPost(exchange(await authorizationCode()))).json()) as Record<
        string,
        unknown
      >;
      const [source] = await db.select().from(schema.oauthAccessToken);
      const issueAfterAnotherRefresh = afterTokenIssue(async () => {
        if (source !== undefined) {
          await db.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.id, source.id));
        }
      });
      try {
        const refreshed = await authPost(
          tokenRequest(
            {
              grant_type: 'refresh_token',
              refresh_token: String(issued['refresh_token']),
              client_id: CLIENT_ID,
            },
            false,
          ),
        );
        expect(await refreshed.json()).toMatchObject({ error: 'invalid_grant' });
        expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
      } finally {
        issueAfterAnotherRefresh.mockRestore();
      }
    });
  });

  test('a grant revoked while a token is being issued keeps no token', async () => {
    await withNativeFetch(async () => {
      const issued = (await (await authPost(exchange(await authorizationCode()))).json()) as Record<
        string,
        unknown
      >;
      const issueThenRevoke = afterTokenIssue(async () => {
        await db.update(schema.mcpGrant).set({ revokedAt: new Date() });
      });
      try {
        const refreshed = await authPost(
          tokenRequest(
            {
              grant_type: 'refresh_token',
              refresh_token: String(issued['refresh_token']),
              client_id: CLIENT_ID,
            },
            false,
          ),
        );
        expect(await refreshed.json()).toMatchObject({ error: 'invalid_grant' });
        expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
        await db.update(schema.mcpGrant).set({ revokedAt: null });
        await db.delete(schema.oauthAccessToken);
        const exchanged = await authPost(exchange(await authorizationCode()));
        expect(await exchanged.json()).toMatchObject({ error: 'invalid_grant' });
        expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
      } finally {
        issueThenRevoke.mockRestore();
      }
    });
  });

  test('a code exchanged twice issues only one token', async () => {
    await withNativeFetch(async () => {
      const code = await authorizationCode();
      expect((await authPost(exchange(code))).status).toBe(200);
      expect(await (await authPost(exchange(code))).json()).toMatchObject({
        error: 'invalid_grant',
      });
      expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(1);
    });
  });

  test('refuses a code after re-consent moved the grant to another workspace', async () => {
    await withNativeFetch(async () => {
      const code = await authorizationCode();
      const other = await createOrganization(workspace.adminUser.id, {
        name: 'Other',
        slug: `other-${newId().slice(-8)}`,
      });
      await recordMcpGrant({
        clientId: CLIENT_ID,
        userId: workspace.adminUser.id,
        organizationId: other.organization.id,
        scopes: 'openid gravity.read',
      });
      const response = await authPost(exchange(code));
      expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
      expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
    });
  });

  test('alternate token paths never hand out an unbound token', async () => {
    await withNativeFetch(async () => {
      const code = await authorizationCode();
      for (const path of ['/api/auth/mcp/token/', '/api/auth/mcp/TOKEN', '/api/auth/mcp/%74oken']) {
        const response = await authPost(
          new Request(`${APP_ORIGIN}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              client_id: CLIENT_ID,
              redirect_uri: CALLBACK_URL,
              code_verifier: MCP_TEST_CODE_VERIFIER,
            }),
          }),
        );
        expect(response.status).toBe(404);
      }
      expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
    });
  });
});
