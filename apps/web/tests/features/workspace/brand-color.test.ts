import { describe, expect, test } from 'bun:test';
import { BRAND_COLORS } from '@gravity/shared/constants';
import { BRAND_COLOR_CLASS } from '@/features/workspace/brand-color.ts';

describe('BRAND_COLOR_CLASS', () => {
  test('gives every brand colour a background token class', () => {
    for (const color of BRAND_COLORS) {
      expect(BRAND_COLOR_CLASS[color]).toMatch(/^bg-[a-z-]+$/);
    }
  });

  test('draws cyan in the accent blue rather than the presence green', () => {
    expect(BRAND_COLOR_CLASS.cyan).toBe('bg-accent');
  });

  test('keeps orange apart from amber, whose token values match priority-high', () => {
    expect(BRAND_COLOR_CLASS.orange).toBe('bg-state-triage');
    expect(BRAND_COLOR_CLASS.amber).toBe('bg-warning');
  });
});
