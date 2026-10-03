import { describe, expect, test } from 'bun:test';
import { randomUUIDv7 } from '../../src/utils/index.ts';

describe('randomUUIDv7', () => {
  test('sorts by creation time', () => {
    const earlier = randomUUIDv7(new Date(1_000));
    const later = randomUUIDv7(new Date(2_000));
    expect(earlier < later).toBe(true);
  });

  test('is a version 7 uuid', () => {
    expect(randomUUIDv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
