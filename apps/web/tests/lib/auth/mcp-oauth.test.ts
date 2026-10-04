import { describe, expect, test } from 'bun:test';
import { refuseUnsafeAuthorize } from '@/lib/auth/mcp-oauth.ts';
import { mcpServerUrl } from '@/lib/env.ts';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function search(extra: Record<string, string>): URLSearchParams {
  return new URLSearchParams({
    prompt: 'consent',
    scope: 'openid gravity.read',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
}

describe('refuseUnsafeAuthorize', () => {
  test('passes a consent request with an S256 challenge for this MCP server', () => {
    expect(refuseUnsafeAuthorize(search({}))).toBeNull();
    expect(refuseUnsafeAuthorize(search({ resource: mcpServerUrl() }))).toBeNull();
  });

  test('passes a request without scope, which better-auth fills with gravity.read', () => {
    const unscoped = search({});
    unscoped.delete('scope');
    expect(refuseUnsafeAuthorize(unscoped)).toBeNull();
    expect(refuseUnsafeAuthorize(search({ scope: 'gravity.write' }))).toBeNull();
  });

  test('refuses a scope that names neither gravity.read nor gravity.write', async () => {
    const refused = refuseUnsafeAuthorize(search({ scope: 'openid offline_access' }));
    expect(refused?.status).toBe(400);
    expect(await refused?.json()).toMatchObject({ error: 'invalid_scope' });
  });

  test('refuses a resource that is not this MCP server', async () => {
    const refused = refuseUnsafeAuthorize(search({ resource: 'https://other.example.com/mcp' }));
    expect(refused?.status).toBe(400);
    expect(await refused?.json()).toMatchObject({ error: 'invalid_target' });
  });

  test('refuses a repeated parameter and names it', async () => {
    const doubled = search({});
    doubled.append('scope', 'gravity.approve');
    const refused = refuseUnsafeAuthorize(doubled);
    expect(refused?.status).toBe(400);
    expect(await refused?.json()).toMatchObject({
      error: 'invalid_request',
      error_description: expect.stringContaining('scope'),
    });
  });
});
