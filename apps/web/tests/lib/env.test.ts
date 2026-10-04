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
  test('derive every OAuth and MCP URL from the origin of BETTER_AUTH_URL', async () => {
    const { absoluteUrl, mcpServerUrl, publicAppUrl } = await import('@/lib/env.ts');
    const previous = {
      BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
      NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
    };
    process.env['BETTER_AUTH_URL'] = 'https://crm.example.com/';
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://preview.example.com';
    try {
      expect(publicAppUrl()).toBe('https://crm.example.com');
      expect(absoluteUrl('/api/oauth/start')).toBe('https://crm.example.com/api/oauth/start');
      expect(mcpServerUrl()).toBe('https://crm.example.com/mcp');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('production refuses a missing or disagreeing public origin instead of using localhost', async () => {
    const { publicAppUrl } = await import('@/lib/env.ts');
    const production = { NODE_ENV: 'production' };
    expect(() =>
      publicAppUrl({ ...production, NEXT_PUBLIC_APP_URL: 'https://crm.example.com' }),
    ).toThrow(/BETTER_AUTH_URL/);
    expect(() =>
      publicAppUrl({ ...production, BETTER_AUTH_URL: 'https://crm.example.com' }),
    ).toThrow(/NEXT_PUBLIC_APP_URL/);
    expect(() =>
      publicAppUrl({
        ...production,
        BETTER_AUTH_URL: 'https://crm.example.com',
        NEXT_PUBLIC_APP_URL: 'https://gravity-git-main.vercel.app',
      }),
    ).toThrow(/same origin/);
    expect(
      publicAppUrl({
        ...production,
        BETTER_AUTH_URL: 'https://crm.example.com/api/auth',
        NEXT_PUBLIC_APP_URL: 'https://crm.example.com/',
      }),
    ).toBe('https://crm.example.com');
    expect(publicAppUrl({})).toBe('http://localhost:3300');
  });

  test('the auth config refuses to boot in production when the origins disagree', async () => {
    const boot = Bun.spawn(['bun', '-e', "await import('./src/lib/auth/server.ts')"], {
      cwd: new URL('../../', import.meta.url).pathname,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://crm.example.com',
        NEXT_PUBLIC_APP_URL: 'https://gravity-git-main.vercel.app',
      },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15_000,
    });
    const [code, stderr] = await Promise.all([boot.exited, new Response(boot.stderr).text()]);
    expect(code).not.toBe(0);
    expect(stderr).toContain('must name the same origin');
  });
});
