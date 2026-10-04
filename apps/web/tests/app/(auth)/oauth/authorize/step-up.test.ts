import { describe, expect, test } from 'bun:test';
import { signedInWithin } from '@/app/(auth)/oauth/authorize/step-up.ts';

describe('signedInWithin', () => {
  test('is true only inside the window and never for a future or invalid time', () => {
    const now = Date.parse('2026-10-04T10:00:00.000Z');
    expect(signedInWithin('2026-10-04T09:58:00.000Z', 300_000, now)).toBe(true);
    expect(signedInWithin(new Date('2026-10-04T09:58:00.000Z'), 300_000, now)).toBe(true);
    expect(signedInWithin('2026-10-04T09:50:00.000Z', 300_000, now)).toBe(false);
    expect(signedInWithin('2026-10-04T09:55:00.000Z', 300_000, now)).toBe(false);
    expect(signedInWithin('2026-10-04T10:05:00.000Z', 300_000, now)).toBe(false);
    expect(signedInWithin('not a date', 300_000, now)).toBe(false);
  });
});
