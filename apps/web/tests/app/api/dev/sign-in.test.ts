import { afterEach, describe, expect, test } from 'bun:test';
import { POST } from '@/app/api/dev/sign-in/route.ts';

const saved = process.env['GRAVITY_DEV_LOGIN'];

afterEach(() => {
  if (saved === undefined) delete process.env['GRAVITY_DEV_LOGIN'];
  else process.env['GRAVITY_DEV_LOGIN'] = saved;
});

function signInRequest(): Request {
  return new Request('http://localhost:3300/api/dev/sign-in', {
    method: 'POST',
    body: JSON.stringify({ email: 'ada@acme.com' }),
  });
}

describe('dev sign-in', () => {
  test('is not found unless explicitly enabled', async () => {
    process.env['GRAVITY_DEV_LOGIN'] = 'false';
    const response = await POST(signInRequest());
    expect(response.status).toBe(404);
  });

  test('is not found when the flag is unset', async () => {
    delete process.env['GRAVITY_DEV_LOGIN'];
    const response = await POST(signInRequest());
    expect(response.status).toBe(404);
  });

  test('is enabled by the flag and reports an unknown user as not found', async () => {
    process.env['GRAVITY_DEV_LOGIN'] = 'true';
    const response = await POST(signInRequest());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
