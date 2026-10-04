import { beforeEach, describe, expect, test } from 'bun:test';
import {
  assertWithinRequestRateLimit,
  consumeRequestRateLimit,
  resetRequestRateLimits,
} from '../../src/auth/request-rate-limit.ts';

beforeEach(() => {
  resetRequestRateLimits();
});

describe('request rate limits without redis', () => {
  test('allow up to the maximum inside the window and refuse the next', async () => {
    const rule = { window: 60, max: 2 };
    expect((await consumeRequestRateLimit('k', rule, 1_000)).allowed).toBe(true);
    expect((await consumeRequestRateLimit('k', rule, 1_001)).allowed).toBe(true);
    expect(await consumeRequestRateLimit('k', rule, 1_002)).toEqual({
      allowed: false,
      retryAfter: 60,
    });
    expect((await consumeRequestRateLimit('other', rule, 1_002)).allowed).toBe(true);
  });

  test('open a new window once the old one ends', async () => {
    const rule = { window: 1, max: 1 };
    await consumeRequestRateLimit('k', rule, 0);
    expect((await consumeRequestRateLimit('k', rule, 500)).allowed).toBe(false);
    expect((await consumeRequestRateLimit('k', rule, 1_001)).allowed).toBe(true);
  });

  test('throw a rate limited error naming the wait', async () => {
    const rule = { window: 30, max: 0 };
    await expect(
      assertWithinRequestRateLimit('k', rule, 'Too many imports.'),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'Too many imports. Try again in 30 seconds.',
    });
  });

  test('pass quietly while within the limit', async () => {
    const rule = { window: 30, max: 1 };
    expect(await assertWithinRequestRateLimit('k', rule, 'Too many imports.')).toBeUndefined();
  });
});
