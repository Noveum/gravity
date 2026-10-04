import { rateLimited } from '@gravity/shared/errors';
import {
  type RateLimitDecision,
  type RateLimitRule,
  redisRateLimitStorage,
} from './rate-limit-storage.ts';

interface Window {
  count: number;
  readonly resetAt: number;
}

const MAX_TRACKED_KEYS = 10_000;
const windows = new Map<string, Window>();

function consumeInMemory(key: string, rule: RateLimitRule, now: number): RateLimitDecision {
  const current = windows.get(key);
  if (current === undefined || current.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
    windows.set(key, { count: 1, resetAt: now + rule.window * 1000 });
    return rule.max >= 1
      ? { allowed: true, retryAfter: null }
      : { allowed: false, retryAfter: rule.window };
  }
  current.count += 1;
  if (current.count <= rule.max) return { allowed: true, retryAfter: null };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

export async function consumeRequestRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): Promise<RateLimitDecision> {
  const storage = redisRateLimitStorage();
  if (storage === undefined) return consumeInMemory(key, rule, now);
  return await storage.consume(`request:${key}`, rule);
}

export async function assertWithinRequestRateLimit(
  key: string,
  rule: RateLimitRule,
  message: string,
): Promise<void> {
  const decision = await consumeRequestRateLimit(key, rule);
  if (decision.allowed) return;
  throw rateLimited(
    decision.retryAfter === null
      ? message
      : `${message} Try again in ${decision.retryAfter} seconds.`,
  );
}

export function resetRequestRateLimits(): void {
  windows.clear();
}
