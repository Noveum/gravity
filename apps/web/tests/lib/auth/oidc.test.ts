import { describe, expect, test } from 'bun:test';
import { OIDC_PROVIDER_ID, oidcPlugins } from '@/lib/auth/oidc.ts';

describe('oidcPlugins', () => {
  test('adds nothing when the slot is empty', () => {
    expect(oidcPlugins(null)).toEqual([]);
  });

  test('registers one generic OAuth provider with discovery from the issuer', () => {
    const plugins = oidcPlugins({
      issuer: 'https://orbit.noveum.ai',
      clientId: 'id',
      clientSecret: 'secret',
      label: 'Orbit',
    });
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.id).toBe('generic-oauth');
    expect(OIDC_PROVIDER_ID).toBe('gravity-oidc');
  });
});
