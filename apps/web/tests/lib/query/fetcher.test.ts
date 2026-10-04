import { afterEach, describe, expect, mock, test } from 'bun:test';
import { z } from 'zod';
import { apiFetch, isRetryable } from '@/lib/query/fetcher.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function failureOf(status: number, body: string, contentType: string): Promise<unknown> {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': contentType } })),
  ) as unknown as typeof fetch;
  try {
    await apiFetch('/api/leads', z.object({ ok: z.boolean() }));
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the request to fail.');
}

describe('isRetryable', () => {
  test('a 403 with an HTML body is not retryable', async () => {
    expect(isRetryable(await failureOf(403, '<html>Forbidden</html>', 'text/html'))).toBe(false);
  });

  test('a 5xx is retryable, with or without a JSON body', async () => {
    expect(isRetryable(await failureOf(502, '<html>Bad gateway</html>', 'text/html'))).toBe(true);
    const json = JSON.stringify({ error: { code: 'internal', message: 'Oops.' } });
    expect(isRetryable(await failureOf(500, json, 'application/json'))).toBe(true);
  });

  test('an unreadable success is retryable and a JSON refusal is not', async () => {
    expect(isRetryable(await failureOf(200, '{"unexpected":1}', 'application/json'))).toBe(true);
    const refusal = JSON.stringify({ error: { code: 'conflict', message: 'Taken.' } });
    expect(isRetryable(await failureOf(409, refusal, 'application/json'))).toBe(false);
  });

  test('a network failure is retryable', () => {
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
  });
});
