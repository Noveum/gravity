import { describe, expect, test } from 'bun:test';
import { GET as authorizationServer } from '@/app/.well-known/oauth-authorization-server/route.ts';
import { GET as protectedResource } from '@/app/.well-known/oauth-protected-resource/mcp/route.ts';
import { GET as protectedResourceRoot } from '@/app/.well-known/oauth-protected-resource/route.ts';
import {
  GET as openidConfiguration,
  OPTIONS as openidPreflight,
} from '@/app/.well-known/openid-configuration/route.ts';
import { POST as authPost } from '@/app/api/auth/[...all]/route.ts';
import { GET as startAuthorization } from '@/app/api/oauth/start/route.ts';
import { mcpServerUrl, publicAppUrl } from '@/lib/env.ts';
import { withNativeFetch } from '../../support/native-fetch.ts';

const CANONICAL = 'https://crm.example.com';
const PREVIEW = 'https://gravity-git-feature.vercel.app';

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function underDeployment<T>(run: () => Promise<T>): Promise<T> {
  const keys = ['BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL', 'VERCEL_URL'] as const;
  const previous = keys.map((key) => [key, process.env[key]] as const);
  process.env['BETTER_AUTH_URL'] = CANONICAL;
  process.env['NEXT_PUBLIC_APP_URL'] = CANONICAL;
  process.env['VERCEL_URL'] = new URL(PREVIEW).host;
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function urlsIn(value: unknown): string[] {
  if (typeof value === 'string') return /^[a-z]+:\/\//.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(urlsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(urlsIn);
  return [];
}

describe('OAuth discovery', () => {
  test('the authorization server starts at the consent-forcing endpoint', async () => {
    await withNativeFetch(async () => {
      const response = authorizationServer();
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      const metadata = await json(response);
      expect(metadata['issuer']).toBe(publicAppUrl());
      expect(metadata['authorization_endpoint']).toBe(`${publicAppUrl()}/api/oauth/start`);
      expect(metadata['token_endpoint']).toBe(`${publicAppUrl()}/api/auth/mcp/token`);
      expect(metadata['registration_endpoint']).toBe(`${publicAppUrl()}/api/auth/mcp/register`);
      expect(metadata['code_challenge_methods_supported']).toEqual(['S256']);
      expect(metadata['scopes_supported']).toEqual(
        expect.arrayContaining(['gravity.read', 'gravity.write', 'gravity.approve']),
      );
    });
  });

  test('the protected resource names the MCP endpoint and gravity scopes', async () => {
    await withNativeFetch(async () => {
      for (const route of [protectedResource, protectedResourceRoot]) {
        const metadata = await json(route());
        expect(metadata['resource']).toBe(mcpServerUrl());
        expect(metadata['authorization_servers']).toEqual([publicAppUrl()]);
        expect(metadata['scopes_supported']).toEqual(expect.arrayContaining(['gravity.read']));
      }
    });
  });

  test('a deployment with several allowed hosts advertises only the canonical origin', async () => {
    await withNativeFetch(async () => {
      await underDeployment(async () => {
        const documents = [
          await json(authorizationServer()),
          await json(openidConfiguration()),
          await json(protectedResource()),
        ];
        const urls = documents.flatMap(urlsIn);
        expect(urls.length).toBeGreaterThan(5);
        for (const url of urls) expect(new URL(url).origin).toBe(CANONICAL);
        expect(documents[2]?.['resource']).toBe(`${CANONICAL}/mcp`);
      });
    });
  });

  test('advertises nothing that is not served', async () => {
    await withNativeFetch(async () => {
      const metadata = await json(authorizationServer());
      const resource = await json(protectedResource());
      for (const document of [metadata, resource]) {
        expect(document).not.toHaveProperty('userinfo_endpoint');
        expect(document).not.toHaveProperty('jwks_uri');
        expect(JSON.stringify(document)).not.toContain('RS256');
      }
      const endpoints = Object.entries(metadata).filter(([key]) => key.endsWith('_endpoint'));
      expect(endpoints.map(([key]) => key).sort()).toEqual([
        'authorization_endpoint',
        'registration_endpoint',
        'token_endpoint',
      ]);
      for (const [key, value] of endpoints) {
        const path = new URL(String(value)).pathname;
        const response =
          key === 'authorization_endpoint'
            ? await startAuthorization(new Request(`http://localhost:3300${path}`))
            : await authPost(
                new Request(`http://localhost:3300${path}`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: '{}',
                }),
              );
        expect({ key, status: response.status }).not.toEqual({ key, status: 404 });
      }
    });
  });

  test('the OpenID alias serves the same document and answers a CORS preflight', async () => {
    await withNativeFetch(async () => {
      expect(await json(openidConfiguration())).toEqual(await json(authorizationServer()));
      const preflight = openidPreflight();
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-headers')).toContain(
        'mcp-protocol-version',
      );
    });
  });
});
