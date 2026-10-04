import { describe, expect, test } from 'bun:test';
import { GET } from '@/app/api/oauth/start/route.ts';

describe('/api/oauth/start', () => {
  test('forces prompt=consent and forwards to the better-auth authorize endpoint', () => {
    const response = GET(
      new Request(
        'http://localhost:3300/api/oauth/start?response_type=code&client_id=abc&code_challenge=xyz&prompt=none',
      ),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/api/auth/mcp/authorize');
    expect(location.searchParams.getAll('prompt')).toEqual(['consent']);
    expect(location.searchParams.get('client_id')).toBe('abc');
    expect(location.searchParams.get('code_challenge')).toBe('xyz');
  });
});
