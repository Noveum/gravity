import { describe, expect, test } from 'bun:test';
import { GET as authorizationServer } from '@/app/.well-known/oauth-authorization-server/route.ts';
import { GET as protectedResource } from '@/app/.well-known/oauth-protected-resource/mcp/route.ts';
import {
  GET as openidConfiguration,
  OPTIONS as openidPreflight,
} from '@/app/.well-known/openid-configuration/route.ts';
import { mcpServerUrl } from '@/lib/env.ts';
import { withNativeFetch } from '../../support/native-fetch.ts';

describe('OAuth discovery', () => {
  test('the authorization server starts at the consent-forcing endpoint', async () => {
    await withNativeFetch(async () => {
      const response = await authorizationServer(
        new Request('http://localhost:3300/.well-known/oauth-authorization-server'),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      const metadata = (await response.json()) as Record<string, unknown>;
      expect(metadata['authorization_endpoint']).toEqual(
        expect.stringMatching(/\/api\/oauth\/start$/),
      );
      expect(metadata['token_endpoint']).toEqual(expect.stringMatching(/\/api\/auth\/mcp\/token$/));
      expect(metadata['registration_endpoint']).toEqual(
        expect.stringMatching(/\/api\/auth\/mcp\/register$/),
      );
      expect(metadata['scopes_supported']).toEqual(
        expect.arrayContaining(['gravity.read', 'gravity.write', 'gravity.approve']),
      );
    });
  });

  test('the protected resource names the MCP endpoint and gravity scopes', async () => {
    await withNativeFetch(async () => {
      const response = await protectedResource(
        new Request('http://localhost:3300/.well-known/oauth-protected-resource/mcp'),
      );
      const metadata = (await response.json()) as Record<string, unknown>;
      expect(metadata['resource']).toBe(mcpServerUrl());
      expect(metadata['scopes_supported']).toEqual(expect.arrayContaining(['gravity.read']));
    });
  });

  test('the OpenID alias serves the same document and answers a CORS preflight', async () => {
    await withNativeFetch(async () => {
      const response = await openidConfiguration(
        new Request('http://localhost:3300/.well-known/openid-configuration'),
      );
      const metadata = (await response.json()) as Record<string, unknown>;
      expect(metadata['authorization_endpoint']).toEqual(
        expect.stringMatching(/\/api\/oauth\/start$/),
      );
      const preflight = openidPreflight();
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-headers')).toContain(
        'mcp-protocol-version',
      );
    });
  });
});
