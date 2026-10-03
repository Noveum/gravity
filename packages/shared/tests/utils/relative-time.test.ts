import { describe, expect, test } from 'bun:test';
import { relativeTime } from '../../src/utils/relative-time.ts';

describe('relativeTime', () => {
  const now = new Date('2026-07-22T12:00:00.000Z');

  test('reports recent moments', () => {
    expect(relativeTime(new Date('2026-07-22T11:59:50.000Z'), now)).toBe('just now');
  });

  test('reports minutes, hours, and days', () => {
    expect(relativeTime(new Date('2026-07-22T11:30:00.000Z'), now)).toBe('30m ago');
    expect(relativeTime(new Date('2026-07-22T09:00:00.000Z'), now)).toBe('3h ago');
    expect(relativeTime(new Date('2026-07-19T12:00:00.000Z'), now)).toBe('3d ago');
  });

  test('reports weeks, months and years', () => {
    expect(relativeTime(new Date('2026-07-01T12:00:00.000Z'), now)).toBe('3w ago');
    expect(relativeTime(new Date('2026-04-22T12:00:00.000Z'), now)).toBe('3mo ago');
    expect(relativeTime(new Date('2024-07-22T12:00:00.000Z'), now)).toBe('2y ago');
  });

  test('reports future moments without calling them past', () => {
    expect(relativeTime(new Date('2026-07-22T12:00:10.000Z'), now)).toBe('in a moment');
    expect(relativeTime(new Date('2026-07-22T12:30:00.000Z'), now)).toBe('in 30m');
    expect(relativeTime(new Date('2026-07-22T15:00:00.000Z'), now)).toBe('in 3h');
    expect(relativeTime(new Date('2026-07-23T12:00:00.000Z'), now)).toBe('tomorrow');
    expect(relativeTime(new Date('2026-07-25T12:00:00.000Z'), now)).toBe('in 3d');
    expect(relativeTime(new Date('2026-08-12T12:00:00.000Z'), now)).toBe('in 3w');
    expect(relativeTime(new Date('2026-10-22T12:00:00.000Z'), now)).toBe('in 3mo');
    expect(relativeTime(new Date('2028-07-22T12:00:00.000Z'), now)).toBe('in 2y');
  });
});
