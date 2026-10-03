import { describe, expect, test } from 'bun:test';
import { deploymentAuthOptions } from '@/lib/auth/deployment.ts';

describe('deploymentAuthOptions', () => {
  test('defaults the auth url to the web port when none is configured', () => {
    expect(deploymentAuthOptions({}).baseURL).toBe('http://localhost:3300');
  });

  test('uses the configured auth url when one is set', () => {
    expect(deploymentAuthOptions({ BETTER_AUTH_URL: 'https://crm.example' }).baseURL).toBe(
      'https://crm.example',
    );
  });

  test('allows the configured extra hosts beside the canonical one', () => {
    expect(
      deploymentAuthOptions({
        BETTER_AUTH_URL: 'https://crm.example',
        GRAVITY_AUTH_ALLOWED_HOSTS: 'preview.crm.example',
      }).baseURL,
    ).toEqual({
      allowedHosts: ['crm.example', 'preview.crm.example'],
      fallback: 'https://crm.example',
    });
  });
});
