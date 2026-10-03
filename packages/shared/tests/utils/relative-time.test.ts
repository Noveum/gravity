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

  test('reports future moments without calling them past, in any time zone', () => {
    const noon = new Date(2026, 6, 22, 12, 0);
    const later = (days: number, hours = 12, minutes = 0, seconds = 0) =>
      new Date(2026, 6, 22 + days, hours, minutes, seconds);
    expect(relativeTime(later(0, 12, 0, 10), noon)).toBe('in a moment');
    expect(relativeTime(later(0, 12, 30), noon)).toBe('in 30m');
    expect(relativeTime(later(0, 15), noon)).toBe('in 3h');
    expect(relativeTime(later(1), noon)).toBe('tomorrow');
    expect(relativeTime(later(3), noon)).toBe('in 3d');
    expect(relativeTime(later(21), noon)).toBe('in 3w');
    expect(relativeTime(later(92), noon)).toBe('in 3mo');
    expect(relativeTime(later(731), noon)).toBe('in 2y');
  });
});

describe('relativeTime calendar days', () => {
  test('tomorrow means the next calendar day, not 24 rounded hours', () => {
    const morning = new Date(2026, 6, 22, 8, 0);
    expect(relativeTime(new Date(2026, 6, 23, 20, 0), morning)).toBe('tomorrow');
    const lateEvening = new Date(2026, 6, 22, 23, 0);
    expect(relativeTime(new Date(2026, 6, 24, 1, 0), lateEvening)).toBe('in 2d');
    expect(relativeTime(new Date(2026, 6, 23, 9, 0), lateEvening)).toBe('tomorrow');
  });

  test('later the same day is still counted in hours', () => {
    const morning = new Date(2026, 6, 22, 8, 0);
    expect(relativeTime(new Date(2026, 6, 22, 20, 0), morning)).toBe('in 12h');
  });
});
