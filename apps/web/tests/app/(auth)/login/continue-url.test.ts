import { describe, expect, test } from 'bun:test';
import { DEFAULT_CONTINUE_URL, safeCallback } from '@/app/(auth)/login/continue-url.ts';

describe('safeCallback', () => {
  test('keeps a same-origin path', () => {
    expect(safeCallback('/settings/members')).toBe('/settings/members');
  });

  test('keeps a same-origin path with a query string and fragment', () => {
    expect(safeCallback('/contacts?view=open&sort=name#top')).toBe(
      '/contacts?view=open&sort=name#top',
    );
  });

  test('falls back to today when nothing usable was given', () => {
    expect(DEFAULT_CONTINUE_URL).toBe('/today');
    expect(safeCallback(undefined)).toBe('/today');
    expect(safeCallback(['/a', '/b'])).toBe('/today');
    expect(safeCallback('')).toBe('/today');
  });

  test.each([
    ['an absolute url', 'https://evil.example/path'],
    ['a protocol-relative url', '//evil.example'],
    ['a backslash after the slash', '/\\evil.example'],
    ['a backslash later in the path', '/foo\\..\\\\evil.example'],
    ['a tab between the slashes', '/\t/evil.example'],
    ['a newline between the slashes', '/\n/evil.example'],
    ['a carriage return between the slashes', '/\r/evil.example'],
    ['a space in the path', '/ /evil.example'],
    ['a non-breaking space in the path', '/ /evil.example'],
    ['a null character', '/\u0000/evil.example'],
    ['a delete character', '/\u007f/evil.example'],
    ['a relative path without a leading slash', 'evil.example'],
    ['a javascript url', 'javascript:alert(1)'],
  ])('refuses %s', (_label, value) => {
    expect(safeCallback(value)).toBe('/today');
  });
});
