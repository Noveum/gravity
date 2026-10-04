import { describe, expect, test } from 'bun:test';
import { GET } from '@/app/api/oauth/start/route.ts';
import { withNativeFetch } from '../../../../support/native-fetch.ts';

describe('/api/oauth/start', () => {
  test('forces prompt=consent and sends a signed out user to sign in on this origin', async () => {
    await withNativeFetch(async () => {
      const response = await GET(
        new Request(
          'http://localhost:3300/api/oauth/start?response_type=code&client_id=abc&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&prompt=none',
        ),
      );
      expect(response.status).toBe(302);
      const location = response.headers.get('location') ?? '';
      expect(location.startsWith('/login?')).toBe(true);
      const search = new URL(location, 'http://localhost:3300').searchParams;
      expect(search.getAll('prompt')).toEqual(['consent']);
      expect(search.get('client_id')).toBe('abc');
    });
  });

  test('refuses a repeated parameter', async () => {
    const response = await GET(
      new Request('http://localhost:3300/api/oauth/start?client_id=abc&client_id=def'),
    );
    expect(response.status).toBe(400);
  });
});
