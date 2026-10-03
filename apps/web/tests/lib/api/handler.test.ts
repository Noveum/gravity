import { describe, expect, test } from 'bun:test';
import { notFound } from '@gravity/shared/errors';
import { z } from 'zod';
import { handleRoute } from '@/lib/api/handler.ts';

describe('handleRoute', () => {
  test('maps a domain error to its status', async () => {
    const response = await handleRoute(() => Promise.reject(notFound('Gone.')));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Gone.' } });
  });

  test('maps a zod error to 422 with issues', async () => {
    const response = await handleRoute(() => Promise.resolve(z.string().parse(1)));
    expect(response.status).toBe(422);
  });

  test('hides unexpected errors', async () => {
    const response = await handleRoute(() => Promise.reject(new Error('secret detail')));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret detail');
  });
});
