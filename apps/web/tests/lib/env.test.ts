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
