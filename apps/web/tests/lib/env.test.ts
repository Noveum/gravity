import { describe, expect, test } from 'bun:test';
import { parseServerEnv } from '@/lib/env.ts';

const base = { BETTER_AUTH_SECRET: 'x'.repeat(32) };

describe('parseServerEnv', () => {
  test('defaults the app url to port 3300', () => {
    expect(parseServerEnv(base).NEXT_PUBLIC_APP_URL).toBe('http://localhost:3300');
  });

  test('reads password auth as a boolean', () => {
    expect(parseServerEnv({ ...base, GRAVITY_PASSWORD_AUTH: 'true' }).GRAVITY_PASSWORD_AUTH).toBe(
      true,
    );
  });

  test('a half configured OIDC slot fails and names the missing variable', () => {
    expect(() =>
      parseServerEnv({ ...base, GRAVITY_OIDC_ISSUER: 'https://orbit.noveum.ai' }),
    ).toThrow(/GRAVITY_OIDC_CLIENT_ID/);
  });

  test('a complete OIDC slot is returned', () => {
    const env = parseServerEnv({
      ...base,
      GRAVITY_OIDC_ISSUER: 'https://orbit.noveum.ai',
      GRAVITY_OIDC_CLIENT_ID: 'id',
      GRAVITY_OIDC_CLIENT_SECRET: 'secret',
      GRAVITY_OIDC_LABEL: 'Orbit',
    });
    expect(env.oidc?.label).toBe('Orbit');
  });
});

describe('public URLs', () => {
  test('derive the MCP resource from the public app URL', async () => {
    const { absoluteUrl, mcpServerUrl, publicAppUrl } = await import('@/lib/env.ts');
    const previous = process.env['NEXT_PUBLIC_APP_URL'];
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://crm.example.com/';
    try {
      expect(publicAppUrl()).toBe('https://crm.example.com');
      expect(absoluteUrl('/api/oauth/start')).toBe('https://crm.example.com/api/oauth/start');
      expect(mcpServerUrl()).toBe('https://crm.example.com/mcp');
    } finally {
      if (previous === undefined) delete process.env['NEXT_PUBLIC_APP_URL'];
      else process.env['NEXT_PUBLIC_APP_URL'] = previous;
    }
  });
});
