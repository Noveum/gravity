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
import { GET as startAuthorization } from '@/app/api/oauth/start/route.ts';
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
  function start(search: URLSearchParams, signedIn = true): Promise<Response> {
    const request = new Request(`${APP_ORIGIN}/api/oauth/start?${search.toString()}`);
    if (signedIn) request.headers.set('cookie', cookie);
    return withNativeFetch(() => startAuthorization(request));
  }

  function pkceSearch(extra: Record<string, string> = {}): URLSearchParams {
    return authorizeSearch({ code_challenge: CHALLENGE, code_challenge_method: 'S256', ...extra });
  }

  test('a signed in user continues to the consent page even when the client asks for none', async () => {
    const response = await start(pkceSearch({ prompt: 'none', resource: mcpServerUrl() }));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '', APP_ORIGIN);
    expect(location.pathname).toBe('/oauth/authorize');
    expect(location.searchParams.get('consent_code')).not.toBeNull();
    const [pending] = await db.select().from(schema.verification);
    expect(JSON.parse(pending?.value ?? '{}')).toMatchObject({ requireConsent: true });
  });

  test('a client that omits scope is asked for gravity.read and reaches a read token', async () => {
    const search = pkceSearch({ resource: mcpServerUrl() });
    search.delete('scope');
    const response = await start(search);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '', APP_ORIGIN);
    expect(location.pathname).toBe('/oauth/authorize');
    const consentCode = location.searchParams.get('consent_code') ?? '';
    const [pending] = await db.select().from(schema.verification);
    expect(JSON.parse(pending?.value ?? '{}')).toMatchObject({
      scope: ['openid', 'offline_access', 'gravity.read'],
    });
    const approved = await finalizeMcpConsent({
      userId: workspace.adminUser.id,
      consentCode,
      accept: true,
      organizationId: workspace.organizationId,
      allowApproval: false,
    });
    const code = new URL(approved.redirectUri).searchParams.get('code') ?? '';
    const issued = await authPost(
      tokenRequest({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: CALLBACK_URL,
        code_verifier: MCP_TEST_CODE_VERIFIER,
      }),
    );
    expect(issued.status).toBe(200);
    const body = (await issued.json()) as { access_token: string; scope: string };
    expect(body.scope.split(' ')).toContain('gravity.read');
    const verified = await verifyMcpAccessToken(body.access_token);
    expect(verified.scopes.split(' ')).toContain('gravity.read');
  });

  test('a request naming no Gravity scope is refused before sign-in or consent', async () => {
    for (const signedIn of [true, false]) {
      for (const scope of ['openid profile email', 'openid gravity.approve']) {
        const response = await start(pkceSearch({ scope }), signedIn);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: 'invalid_scope',
          error_description: 'Ask for gravity.read, gravity.write or both.',
        });
      }
      const response = await start(pkceSearch({ scope: 'openid profile email' }), signedIn);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: 'invalid_scope',
        error_description: 'Ask for gravity.read, gravity.write or both.',
      });
    }
    expect(await db.select().from(schema.verification)).toHaveLength(0);
  });

  test('a signed out user is sent to sign in with consent still forced', async () => {
    const response = await start(pkceSearch({ prompt: 'login' }), false);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '', APP_ORIGIN);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.getAll('prompt')).toEqual(['consent']);
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
  });

  test('refuses a code challenge that is missing, malformed or not S256', async () => {
    for (const search of [
      authorizeSearch(),
      pkceSearch({ code_challenge: 'A'.repeat(42) }),
      pkceSearch({ code_challenge_method: 'plain' }),
      authorizeSearch({ code_challenge: CHALLENGE }),
    ]) {
      const response = await start(search);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_request' });
    }
    expect(await db.select().from(schema.verification)).toHaveLength(0);
  });

  test('refuses another resource with invalid_target', async () => {
    const response = await start(pkceSearch({ resource: 'https://elsewhere.example.com/mcp' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_target' });
  });

  test('refuses every repeated parameter before better-auth reads it', async () => {
    for (const [key, value] of [
      ['scope', 'openid gravity.write gravity.approve'],
      ['code_challenge_method', 'plain'],
      ['state', 'state_other'],
      ['redirect_uri', 'https://elsewhere.example.com/cb'],
    ] as const) {
      const search = pkceSearch();
      search.append(key, value);
      const response = await start(search);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_request' });
    }
    expect(await db.select().from(schema.verification)).toHaveLength(0);
  });

  test('a disabled client is refused before any consent request exists', async () => {
    await db
      .update(schema.oauthApplication)
      .set({ disabled: true })
      .where(eq(schema.oauthApplication.clientId, CLIENT_ID));
    const response = await start(pkceSearch());
    expect(response.headers.get('location')).toContain('error=client_disabled');
    expect(await db.select().from(schema.verification)).toHaveLength(0);
  });
});

describe('unserved better-auth endpoints', () => {
  test('the raw plugin endpoints answer 404 on every spelling', async () => {
    await withNativeFetch(async () => {
      const search = authorizeSearch({
        prompt: 'consent',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
      }).toString();
      for (const path of [
        `/api/auth/mcp/authorize?${search}`,
        `/api/auth/mcp/authorize/?${search}`,
        `/api/auth/mcp/AUTHORIZE?${search}`,
        `/api/auth/mcp/%61uthorize?${search}`,
        '/api/auth/mcp/get-session',
        '/api/auth/mcp/userinfo',
        '/api/auth/mcp/jwks',
        '/api/auth/.well-known/oauth-authorization-server',
        '/api/auth/.well-known/oauth-protected-resource',
        '/api/auth/.well-known/openid-configuration',
      ]) {
        const request = new Request(`${APP_ORIGIN}${path}`);
        request.headers.set('cookie', cookie);
        expect({ path, status: (await GET(request)).status }).toEqual({ path, status: 404 });
      }
      const consent = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/oauth2/consent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie, origin: APP_ORIGIN },
          body: JSON.stringify({ accept: true }),
        }),
      );
      expect(consent.status).toBe(404);
    });
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

  test('a client without a name is registered under its redirect host', async () => {
    await withNativeFetch(async () => {
      for (const [uris, expected] of [
        [[CALLBACK_URL], '127.0.0.1'],
        [['com.example.agent:/oauth'], 'Unnamed agent'],
      ] as const) {
        const response = await authPost(
          registerRequest({ redirect_uris: uris, token_endpoint_auth_method: 'none' }),
        );
        expect(response.status).toBe(201);
        const clientId = String(((await response.json()) as { client_id?: unknown }).client_id);
        const [stored] = await db
          .select()
          .from(schema.oauthApplication)
          .where(eq(schema.oauthApplication.clientId, clientId));
        expect(stored?.name).toBe(expected);
      }
      const blank = await authPost(
        registerRequest({ client_name: '   ', redirect_uris: ['https://agent.example.com/cb'] }),
      );
      expect(blank.status).toBe(201);
    });
    const names = (await db.select().from(schema.oauthApplication)).map((row) => row.name);
    expect(names).toContain('agent.example.com');
  });

  test('refuses OS handler redirect schemes', async () => {
    await withNativeFetch(async () => {
      for (const uri of [
        'ms-msdt:/id PCWDiagnostic',
        'search-ms:query=calc',
        'ms-settings:privacy',
        'ms-officecmd:{}',
        'ms-word:ofe|u|https://evil.example/a.docx',
        'smb://evil.example/share',
      ]) {
        const response = await authPost(
          registerRequest({ client_name: 'Handler', redirect_uris: [uri] }),
        );
        expect({ uri, status: response.status }).toEqual({ uri, status: 400 });
      }
    });
    expect(await db.select().from(schema.oauthApplication)).toHaveLength(1);
  });

  test('accepts only an https logo and small metadata', async () => {
    await withNativeFetch(async () => {
      for (const extra of [
        { logo_uri: 'javascript:alert(1)' },
        { logo_uri: 'http://agent.example.com/logo.png' },
        { logo_uri: 'https://agent.example.com/a.png,javascript:alert(1)' },
        { metadata: { padding: 'x'.repeat(2100) } },
      ]) {
        const response = await authPost(
          registerRequest({ client_name: 'Logo', redirect_uris: [CALLBACK_URL], ...extra }),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'invalid_client_metadata' });
      }
      const fine = await authPost(
        registerRequest({
          client_name: 'Logo',
          redirect_uris: [CALLBACK_URL],
          logo_uri: 'https://agent.example.com/logo.png',
          metadata: { build: '1.2.3' },
          token_endpoint_auth_method: 'none',
        }),
      );
      expect(fine.status).toBe(201);
    });
    const icons = (await db.select().from(schema.oauthApplication)).map((row) => row.icon);
    expect(icons).toContain('https://agent.example.com/logo.png');
  });

  test('refuses a registration body above 64KB without storing it', async () => {
    await withNativeFetch(async () => {
      const response = await authPost(
        registerRequest({
          client_name: 'Large',
          redirect_uris: [CALLBACK_URL],
          software_statement: 'x'.repeat(70_000),
        }),
      );
      expect(response.status).toBe(413);
    });
    expect(await db.select().from(schema.oauthApplication)).toHaveLength(1);
  });

  test('a streamed body above 64KB with no content-length ends with 413', async () => {
    await withNativeFetch(async () => {
      for (const path of ['/api/auth/mcp/register', '/api/auth/mcp/token']) {
        const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent === 10) {
              controller.close();
              return;
            }
            sent += 1;
            controller.enqueue(chunk);
          },
        });
        const request = new Request(`${APP_ORIGIN}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.30' },
          body,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        expect(request.headers.get('content-length')).toBeNull();
        const outcome = await Promise.race([
          authPost(request).then((response) => response.status),
          Bun.sleep(3_000).then(() => 'timed out'),
        ]);
        expect({ path, outcome }).toEqual({ path, outcome: 413 });
      }
    });
    expect(await db.select().from(schema.oauthApplication)).toHaveLength(1);
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

  test('a consent code or a code without a recorded grant is never exchanged', async () => {
    await withNativeFetch(async () => {
      const consentCode = await insertMcpConsentRequest({
        clientId: CLIENT_ID,
        userId: workspace.adminUser.id,
        scope: ['openid', 'gravity.read'],
        redirectUri: CALLBACK_URL,
      });
      expect(await (await authPost(exchange(consentCode))).json()).toMatchObject({
        error: 'invalid_grant',
      });
      const ungranted = await insertMcpConsentRequest({
        clientId: CLIENT_ID,
        userId: workspace.adminUser.id,
        scope: ['openid', 'gravity.read'],
        redirectUri: CALLBACK_URL,
      });
      const [row] = await db
        .select()
        .from(schema.verification)
        .where(eq(schema.verification.identifier, ungranted));
      await db
        .update(schema.verification)
        .set({
          value: JSON.stringify({ ...JSON.parse(row?.value ?? '{}'), requireConsent: false }),
        })
        .where(eq(schema.verification.identifier, ungranted));
      expect(await (await authPost(exchange(ungranted))).json()).toMatchObject({
        error: 'invalid_grant',
      });
      expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
      expect(await db.select().from(schema.verification)).toHaveLength(2);
    });
  });

  test('a refresh for a revoked grant is refused before better-auth issues anything', async () => {
    await withNativeFetch(async () => {
      const issued = (await (await authPost(exchange(await authorizationCode()))).json()) as Record<
        string,
        unknown
      >;
      await db.update(schema.mcpGrant).set({ revokedAt: new Date() });
      const issue = spyOn(auth.api, 'mcpOAuthToken');
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
        expect(issue).not.toHaveBeenCalled();
      } finally {
        issue.mockRestore();
      }
    });
  });

  test('a refresh for a disabled client is refused before better-auth issues anything', async () => {
    await withNativeFetch(async () => {
      const issued = (await (await authPost(exchange(await authorizationCode()))).json()) as Record<
        string,
        unknown
      >;
      await db
        .update(schema.oauthApplication)
        .set({ disabled: true })
        .where(eq(schema.oauthApplication.clientId, CLIENT_ID));
      const before = await db.select().from(schema.oauthAccessToken);
      const issue = spyOn(auth.api, 'mcpOAuthToken');
      try {
        const refreshed = await authPost(
          tokenRequest({
            grant_type: 'refresh_token',
            refresh_token: String(issued['refresh_token']),
            client_id: CLIENT_ID,
          }),
        );
        expect(refreshed.status).toBe(401);
        expect(await refreshed.json()).toMatchObject({
          error: 'invalid_client',
          error_description: 'This client has been disabled. Reconnect Gravity to continue.',
        });
        expect(issue).not.toHaveBeenCalled();
        expect(await db.select().from(schema.oauthAccessToken)).toEqual(before);
      } finally {
        issue.mockRestore();
      }
    });
  });

  test('a client disabled after consent gets no token', async () => {
    await withNativeFetch(async () => {
      const code = await authorizationCode();
      await db
        .update(schema.oauthApplication)
        .set({ disabled: true })
        .where(eq(schema.oauthApplication.clientId, CLIENT_ID));
      expect(await (await authPost(exchange(code))).json()).toMatchObject({
        error: 'invalid_client',
      });
      expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
    });
  });

  test('a repeated token parameter is refused without consuming the code', async () => {
    await withNativeFetch(async () => {
      const code = await authorizationCode();
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: CALLBACK_URL,
        code_verifier: MCP_TEST_CODE_VERIFIER,
      });
      body.append('redirect_uri', 'https://elsewhere.example.com/cb');
      const doubled = await authPost(
        new Request(`${APP_ORIGIN}/api/auth/mcp/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        }),
      );
      expect(await doubled.json()).toMatchObject({ error: 'invalid_request' });
      expect(await db.select().from(schema.oauthAccessToken)).toHaveLength(0);
      expect((await authPost(exchange(code))).status).toBe(200);
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
