import { describe, expect, test } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';

describe('useDelayedFlag', () => {
  test('stays false for the delay, then turns true, and resets when inactive', async () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 50), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true), { timeout: 500 });
    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});
