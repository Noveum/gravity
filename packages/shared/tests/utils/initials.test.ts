import { describe, expect, test } from 'bun:test';
import { initialsOf } from '../../src/utils/initials.ts';

describe('initialsOf', () => {
  test('uses the first and last name', () => {
    expect(initialsOf('Shashank Agarwal')).toBe('SA');
  });

  test('handles a single name', () => {
    expect(initialsOf('Pulkit')).toBe('P');
  });

  test('handles empty input', () => {
    expect(initialsOf('   ')).toBe('?');
  });
});
